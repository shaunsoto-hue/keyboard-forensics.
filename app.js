const $=id=>document.getElementById(id);
const file=$("file"),video=$("video"),work=$("work"),drop=$("drop");
const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d",{willReadFrequently:true});
let src=null,events=[],stop=false,prev=null,prevText="",ocrWorker=null;

function fmt(t){return Math.floor(t/60)+":"+String((t%60).toFixed(2)).padStart(5,"0")}
function load(f){
  if(!f||!f.type.startsWith("video/"))return;
  src=f; video.src=URL.createObjectURL(f); work.classList.remove("hidden");
  video.onloadedmetadata=()=> $("duration").textContent=fmt(video.duration);
  $("status").textContent="Video loaded; processing stays in this browser.";
}
$("choose").onclick=()=>file.click();
file.onchange=e=>load(e.target.files[0]);
["dragenter","dragover"].forEach(x=>drop.addEventListener(x,e=>e.preventDefault()));
drop.addEventListener("drop",e=>{e.preventDefault();load(e.dataTransfer.files[0])});

function seek(t){return new Promise(r=>{
  const h=()=>{video.removeEventListener("seeked",h);r()}; video.addEventListener("seeked",h);
  video.currentTime=t;
})}

function frameData(){
  const w=480,h=Math.max(270,Math.round(video.videoHeight/video.videoWidth*w));
  canvas.width=w;canvas.height=h;ctx.drawImage(video,0,0,w,h);
  return ctx.getImageData(0,0,w,h);
}
function visualDiff(d){
  let diff=0,n=0;
  if(prev&&prev.data.length===d.data.length){
    for(let i=0;i<d.data.length;i+=16){
      diff+=Math.abs(d.data[i]-prev.data[i])+Math.abs(d.data[i+1]-prev.data[i+1])+Math.abs(d.data[i+2]-prev.data[i+2]); n+=3;
    }
  }
  prev=d; return n?diff/n:0;
}
function add(t,type,detail,c,extra={}){
  events.push({time:+t.toFixed(2),type,detail,confidence:+Math.max(0,Math.min(1,c)).toFixed(2),...extra});
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

async function ocrText(image){
  if(!ocrWorker){
    $("status").textContent="Starting OCR engine…";
    ocrWorker=await Tesseract.createWorker("eng");
  }
  const r=await ocrWorker.recognize(image);
  return (r.data.text||"").replace(/\s+/g," ").trim();
}
function inferTextChange(oldText,newText){
  if(oldText===newText)return null;
  if(newText.startsWith(oldText)&&newText.length>oldText.length){
    const added=newText.slice(oldText.length);
    if(added.length<=4)return {key:added===" "?"Space":added,detail:"Visible text gained characters after the previous frame."};
  }
  if(oldText.length>newText.length&&oldText.startsWith(newText)){
    return {key:oldText.length-newText.length===1?"Backspace":"Backspace ×"+(oldText.length-newText.length),detail:"Visible text lost character(s) between frames."};
  }
  if(newText.includes(oldText)&&newText.length>oldText.length){
    const added=newText.replace(oldText,"");
    if(added.length<=4)return {key:added===" "?"Space":added,detail:"OCR found a short inserted text segment."};
  }
  return null;
}

async function analyze(){
  if(!src)return;
  events=[];prev=null;prevText="";stop=false;$("results").innerHTML="";
  const fps=+$("rate").value,total=video.duration,mode=$("mode").value;
  const doOCR=mode==="smart"||mode==="ocr";
  let lastOcrTime=-Infinity;
  for(let t=0;t<=total;t+=1/fps){
    if(stop)break;
    await seek(Math.min(t,total));
    const d=frameData(),diff=visualDiff(d);
    if(diff>18 && mode!=="ocr")
      add(t,"Visual evidence","Abrupt screen change; inspect this moment for typing, focus, selection, or UI activity.",Math.min(.97,.4+diff/90));
    if(doOCR && (t-lastOcrTime>=1/fps-0.01 || diff>24)){
      lastOcrTime=t;
      try{
        const text=await ocrText(canvas);
        const change=inferTextChange(prevText,text);
        if(change)add(t,"Possible key",change.detail,.78,{key:change.key,observedText:text});
        prevText=text;
      }catch(err){$("status").textContent="OCR error; continuing with visual evidence."}
    }
    $("bar").style.width=(total?Math.min(100,t/total*100):100)+"%";
    $("frames").textContent=Math.ceil(t*fps);
    $("status").textContent=(doOCR?"OCR + visual analysis: ":"Visual analysis: ")+fmt(t);
  }
  $("count").textContent=events.length;render();
  $("status").textContent=stop?"Stopped.":"Analysis complete. Key names are reported only when the recording provides supporting evidence.";
}
function render(){
  if(!events.length){$("results").innerHTML='<p class="empty">No candidate events detected. This does not prove no keys were pressed.</p>';return}
  $("results").innerHTML=events.map(e=>{
    const key=e.key?'<span class="key">Key: <b>'+escapeHtml(e.key)+'</b></span>':"";
    return '<div class="event"><span class="time">'+fmt(e.time)+'</span><div><b>'+escapeHtml(e.type)+'</b>'+key+'<p>'+escapeHtml(e.detail)+'</p></div><span class="badge">'+Math.round(e.confidence*100)+'% inferred</span></div>'
  }).join("");
}
$("analyze").onclick=analyze;
$("stop").onclick=()=>stop=true;
function dl(name,data,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;a.click()}
$("json").onclick=()=>dl("keyboard-forensics.json",JSON.stringify({file:src?.name,events},null,2),"application/json");
$("csv").onclick=()=>dl("keyboard-forensics.csv","time,type,key,detail,confidence\n"+events.map(e=>[e.time,e.type,e.key||"",e.detail,e.confidence].map(x=>'"'+String(x).replaceAll('"','""')+'"').join(",")).join("\n"),"text/csv");