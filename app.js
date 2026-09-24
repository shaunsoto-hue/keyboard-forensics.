const $=id=>document.getElementById(id);
const file=$("file"),video=$("video"),work=$("work"),drop=$("drop");
const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d",{willReadFrequently:true});
let src=null,events=[],stop=false,prev=null,prevText="",ocrWorker=null,audioPeaks=[];

function fmt(t){return Math.floor(t/60)+":"+String((t%60).toFixed(2)).padStart(5,"0")}
function load(f){
  if(!f||!f.type.startsWith("video/"))return;
  src=f;video.src=URL.createObjectURL(f);work.classList.remove("hidden");
  video.onloadedmetadata=()=>{$("duration").textContent=fmt(video.duration);$("resolution").textContent=video.videoWidth+"×"+video.videoHeight};
  $("status").textContent="Video loaded; processing stays in this browser.";
}
$("choose").onclick=()=>file.click();file.onchange=e=>load(e.target.files[0]);
["dragenter","dragover"].forEach(x=>drop.addEventListener(x,e=>e.preventDefault()));
drop.addEventListener("drop",e=>{e.preventDefault();load(e.dataTransfer.files[0])});

function seek(t){return new Promise(r=>{const h=()=>{video.removeEventListener("seeked",h);r()};video.addEventListener("seeked",h);video.currentTime=t})}
function frameData(){
  const w=480,h=Math.max(270,Math.round(video.videoHeight/video.videoWidth*w));
  canvas.width=w;canvas.height=h;ctx.drawImage(video,0,0,w,h);return ctx.getImageData(0,0,w,h);
}
function visualDiff(d){
  let diff=0,n=0;
  if(prev&&prev.data.length===d.data.length)for(let i=0;i<d.data.length;i+=16){diff+=Math.abs(d.data[i]-prev.data[i])+Math.abs(d.data[i+1]-prev.data[i+1])+Math.abs(d.data[i+2]-prev.data[i+2]);n+=3}
  prev=d;return n?diff/n:0;
}
function add(t,type,detail,c,extra={}){
  const e={time:+t.toFixed(2),type,detail,confidence:+Math.max(0,Math.min(1,c)).toFixed(2),...extra};
  if(!events.some(x=>Math.abs(x.time-e.time)<.18&&x.type===e.type&&x.key===e.key))events.push(e);
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

async function ocrText(image){
  if(!ocrWorker){$("status").textContent="Starting OCR engine…";ocrWorker=await Tesseract.createWorker("eng")}
  const r=await ocrWorker.recognize(image);return(r.data.text||"").replace(/\s+/g," ").trim();
}
function maskedCount(s){return(s.match(/[•●∙◦*]+/g)||[]).reduce((n,x)=>n+x.length,0)}
function inferAction(oldText,newText){
  if(oldText===newText)return null;
  const oldMask=maskedCount(oldText),newMask=maskedCount(newText);
  if(newMask>oldMask)return{type:"Masked password input",key:"Hidden character",detail:"A password-style mask gained "+(newMask-oldMask)+" character(s). The underlying character is not visible in the recording.",confidence:.9};
  if(oldMask>newMask)return{type:"Masked password edit",key:"Backspace",detail:"A password-style mask lost "+(oldMask-newMask)+" character(s).",confidence:.9};
  if(newText.startsWith(oldText)&&newText.length>oldText.length){
    const added=newText.slice(oldText.length);if(added.length<=4)return{type:"Text input",key:added===" "?"Space":added,detail:"OCR observed new visible character(s).",confidence:.8};
  }
  if(oldText.length>newText.length&&oldText.startsWith(newText)){
    const n=oldText.length-newText.length;return{type:"Text edit",key:n===1?"Backspace":"Backspace ×"+n,detail:"OCR observed character(s) disappearing.",confidence:.82};
  }
  if(newText.includes(oldText)&&newText.length>oldText.length){
    const added=newText.replace(oldText,"");if(added.length<=4)return{type:"Text input",key:added===" "?"Space":added,detail:"OCR found a short inserted text segment.",confidence:.75};
  }
  return null;
}
async function analyzeAudio(){
  audioPeaks=[];if(!src)return;
  try{
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    const ac=new AC(),buf=await ac.decodeAudioData(await src.arrayBuffer()),data=buf.getChannelData(0),step=Math.max(1,Math.floor(buf.sampleRate*.01));
    let vals=[];for(let i=0;i<data.length;i+=step){let sum=0,end=Math.min(data.length,i+step);for(let j=i;j<end;j++)sum+=data[j]*data[j];vals.push(Math.sqrt(sum/(end-i)))}
    const avg=vals.reduce((a,b)=>a+b,0)/Math.max(1,vals.length);
    const variance=vals.reduce((a,b)=>a+(b-avg)**2,0)/Math.max(1,vals.length),threshold=avg+Math.sqrt(variance)*2.2;
    for(let i=1;i<vals.length-1;i++)if(vals[i]>threshold&&vals[i]>vals[i-1]*1.35&&vals[i]>=vals[i+1])audioPeaks.push(i*.01);
    await ac.close();
  }catch(e){audioPeaks=[]}
}
function nearestPeak(t){let best=Infinity;for(const p of audioPeaks)best=Math.min(best,Math.abs(p-t));return best<=.18?best:null}

async function analyze(){
  if(!src)return;
  events=[];prev=null;prevText="";stop=false;$("results").innerHTML="";
  const fps=+$("rate").value,total=video.duration,mode=$("mode").value,doOCR=mode==="smart"||mode==="ocr";
  $("status").textContent="Reading the video's audio track…";if(mode!=="ocr")await analyzeAudio();
  let lastOcr=-Infinity;
  for(let t=0;t<=total;t+=1/fps){
    if(stop)break;await seek(Math.min(t,total));const d=frameData(),diff=visualDiff(d),peak=nearestPeak(t);
    if(diff>18&&mode!=="ocr")add(t,"Screen/UI change","A measurable visual change occurred. This may represent typing, clicking, navigation, focus, selection, or another UI action.",Math.min(.96,.4+diff/90),{evidence:"video frame difference",audioEvidence:!!peak});
    if(peak&&mode!=="ocr")add(t,"Keyboard-like audio","A short audio transient was detected near this timestamp; it may be a key, click, notification, or other sound.",.55,{evidence:"audio transient"});
    if(doOCR&&(t-lastOcr>=1/fps-.01||diff>24)){
      lastOcr=t;
      try{const text=await ocrText(canvas),change=inferAction(prevText,text);if(change)add(t,change.type,change.detail,change.confidence,{key:change.key,observedText:text,audioEvidence:!!peak});prevText=text}
      catch(e){$("status").textContent="OCR error; continuing with other evidence."}
    }
    $("bar").style.width=(total?Math.min(100,t/total*100):100)+"%";$("frames").textContent=Math.ceil(t*fps);
    $("status").textContent=(doOCR?"OCR + action analysis: ":"Action analysis: ")+fmt(t);
  }
  $("count").textContent=events.length;events.sort((a,b)=>a.time-b.time);render();
  $("status").textContent=stop?"Stopped.":"Analysis complete. The timeline combines observable video/audio evidence; it is not a hidden keyboard log.";
}
function render(){
  if(!events.length){$("results").innerHTML='<p class="empty">No candidate actions detected. This does not prove nothing happened.</p>';return}
  $("results").innerHTML=events.map(e=>'<div class="event"><span class="time">'+fmt(e.time)+'</span><div><b>'+escapeHtml(e.type)+'</b>'+(e.key?'<span class="key">Key: <b>'+escapeHtml(e.key)+'</b></span>':"")+'<p>'+escapeHtml(e.detail)+'</p></div><span class="badge">'+Math.round(e.confidence*100)+'% inferred</span></div>').join("")
}
$("analyze").onclick=analyze;$("stop").onclick=()=>stop=true;
function dl(name,data,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click()}
$("json").onclick=()=>dl("keyboard-forensics.json",JSON.stringify({file:src?.name,metadata:{type:src?.type,size:src?.size,duration:video.duration,width:video.videoWidth,height:video.videoHeight},events},null,2),"application/json");
$("csv").onclick=()=>dl("keyboard-forensics.csv","time,type,key,detail,confidence,audioEvidence\n"+events.map(e=>[e.time,e.type,e.key||"",e.detail,e.confidence,e.audioEvidence||false].map(x=>'"'+String(x).replaceAll('"','""')+'"').join(",")).join("\n"),"text/csv");