const $ = id => document.getElementById(id);
const meta = {
  full: {name: "Données complètes", color: "#3479ad", note: "Y − P"},
  naive: {name: "Naïf", color: "#cf7843", note: "R − P"},
  oracle: {name: "IPCW oracle", color: "#117c83", note: "R / G⋆ − P"},
  plugin: {name: "IPCW estimé", color: "#9167b4", note: "R / Ĝ − P"}
};
const methods = Object.keys(meta);
const number = (v, digits=4) => v == null ? "Indisponible" : v.toLocaleString("fr-FR", {minimumFractionDigits:digits,maximumFractionDigits:digits});
const percent = v => v == null ? "—" : number(100*v,1)+" %";
const defaults = {n:3000, history:120, g:.7, seed:20261021, repetitions:500};
let run = null, mc = null, busy = true, ready = false, numpyVersion = "";
const worker = new Worker("./worker.js", {type:"module"});
const plotOptions = {responsive:true, displaylogo:false, modeBarButtonsToRemove:["lasso2d","select2d"], toImageButtonOptions:{format:"svg"}};
const layout = (xTitle,yTitle) => ({margin:{l:58,r:20,t:15,b:64}, paper_bgcolor:"transparent",plot_bgcolor:"white",
  font:{family:"Inter, system-ui, sans-serif",size:10,color:"#657780"},
  xaxis:{title:{text:xTitle,standoff:12},gridcolor:"#eef2f3",zeroline:false},
  yaxis:{title:{text:yTitle,standoff:10},gridcolor:"#eef2f3",zerolinecolor:"#a8b9bf"},
  legend:{orientation:"h",y:-.3,x:0,font:{size:9}},hovermode:"x unified"});
function parameters(){
  if (!$('parameters').reportValidity()) return null;
  return Object.fromEntries(Object.keys(defaults).map(k=>[k,Number($(k).value)]));
}
function setBusy(value){
  busy=value; for(const id of ["run","repeat","reset"]) $(id).disabled=value||!ready;
  for(const key of Object.keys(defaults)) $(key).disabled=value;
  $("export").disabled=!run||value;
}
function showError(message){$("error").textContent=message;$("error").hidden=false;$("progress").hidden=true;setBusy(false);}
function submit(type){
  const config=parameters(); if(!config||busy)return;
  $("error").hidden=true;setBusy(true);
  $("status").textContent=type==="trajectory"?"Calcul de la trajectoire…":"Répétitions en cours…";
  if(type==="monte_carlo"){$("progress").hidden=false;$("progress").value=0;}
  worker.postMessage({type,config});
}
function line(name,x,y,dash){return {x,y,name:meta[name].name,legendgroup:name,type:"scatter",mode:"lines",line:{color:meta[name].color,width:dash?1.3:1.8,dash:dash||"solid"},showlegend:!dash,hovertemplate:dash?"Espérance : %{y:.4f}<extra></extra>":undefined};}
function label(name){return `<span class="swatch" style="background:${meta[name].color}"></span>${meta[name].name}<span class="method-note">${meta[name].note}</span>`;}
function stamp(config){return `n = ${number(config.n,0)} · m = ${number(config.history,0)} · G⋆ = ${number(config.g,2)} · graine ${config.seed}`;}
function updateStale(){
  const cfg=Object.fromEntries(Object.keys(defaults).map(k=>[k,Number($(k).value)]));
  const differs=(a,b)=>Object.keys(defaults).some(k=>k!=="repetitions"&&a[k]!==b[k]);
  $("stale").hidden=!(run&&differs(cfg,run.config)||mc&&(differs(cfg,mc.config)||cfg.repetitions!==mc.config.repetitions));
}
function showTrajectory(data){
  run=data; $("run-description").textContent=stamp(data.config)+" · 12 mois · un patient par étape";
  $("stat-n").textContent=number(data.config.n,0);$("stat-g").textContent=percent(data.config.g);
  $("stat-ghat").textContent=data.ghat==null?"—":number(data.ghat,4);
  $("stat-unknown").textContent=percent(data.counts.unknown/data.config.n);
  const counts=data.counts;
  $("observation-bar").innerHTML=[[counts.survival,"#117c83"],[counts.event,"#3479ad"],[counts.unknown,"#c2cdd1"]].map(([n,c])=>`<span style="width:${100*n/data.config.n}%;background:${c}"></span>`).join("");
  $("observation-text").textContent=`${number(counts.survival,0)} survies connues · ${number(counts.event,0)} événements observés avant 12 mois · ${number(counts.unknown,0)} statuts inconnus`;
  $("method-table").innerHTML=methods.map(name=>{const m=data.methods[name];return `<tr><td>${label(name)}</td><td>${number(m?.mean)}</td><td>${number(m?.expected_mean)}</td><td>${!m?"Indisponible":m.first_alert?`<span class="alert-tag">Patient ${m.first_alert}</span>`:"Aucune"}</td></tr>`;}).join("");
  const means=[], processes=[];
  for(const name of methods){const m=data.methods[name];if(!m)continue;
    means.push(line(name,data.n,m.running_mean));means.push(line(name,data.n,m.expected_running_mean,"dot"));
    const process=line(name,[0,...data.n],[0,...m.log10_e]);
    if(name==="naive")process.visible="legendonly";
    processes.push(process);
  }
  Plotly.react("means",means,layout("Patients évalués","Score moyen"),plotOptions);
  const processLayout=layout("Patients évalués","log₁₀(Eₙ)");
  const threshold=Math.log10(1/data.alpha);
  processLayout.shapes=[{type:"line",xref:"paper",x0:0,x1:1,y0:threshold,y1:threshold,line:{color:"#b15143",width:1.2,dash:"dash"}}];
  processLayout.annotations=[{xref:"paper",x:1,y:threshold,text:"Seuil E = 20",showarrow:false,xanchor:"right",yshift:10,font:{color:"#a14a3e",size:10}}];
  Plotly.react("eprocess",processes,processLayout,plotOptions);
  if(document.querySelector("details").open)drawCalibration();
  if(data.ghat==null)showError("Ĝ indisponible : l'historique ne permet pas une estimation positive à 12 mois. Augmente m ou G⋆.");
  updateStale();
}
function drawCalibration(){
  if(!run)return;
  const traces=[{x:[0,1],y:[0,1],type:"scatter",mode:"lines",name:"Calibration parfaite",line:{color:"#8b9b9f",dash:"dot"}}];
  for(const name of methods){if(!run.methods[name])continue;traces.push({x:run.bins.map(b=>b.p),y:run.bins.map(b=>b[name]),text:run.bins.map(b=>`${b.count} patients`),type:"scatter",mode:"lines+markers",name:meta[name].name,line:{color:meta[name].color,width:1.5},marker:{size:7},hovertemplate:"P moyen : %{x:.3f}<br>Survie moyenne : %{y:.3f}<br>%{text}<extra>%{fullData.name}</extra>"});}
  const l=layout("Prédiction moyenne du groupe","Survie moyenne (pondérée pour IPCW)");l.hovermode="closest";l.xaxis.range=[0,1];
  Plotly.react("calibration",traces,l,plotOptions);
}
function showMonteCarlo(data){
  mc=data;$("mc-empty").hidden=true;$("mc-results").hidden=false;
  $("mc-description").textContent=`${number(data.config.repetitions,0)} répétitions · ${stamp(data.config)}`;
  const rates=methods.map(k=>data.summary[k]);
  const trace={x:methods.map(k=>meta[k].name),y:rates.map(r=>r.rate==null?null:100*r.rate),type:"bar",marker:{color:methods.map(k=>meta[k].color)},width:.45,
    error_y:{type:"data",symmetric:false,array:rates.map(r=>r.rate==null?0:100*(r.interval[1]-r.rate)),arrayminus:rates.map(r=>r.rate==null?0:100*(r.rate-r.interval[0])),color:"#475b65",thickness:1.3,width:5},
    text:rates.map(r=>percent(r.rate)),textposition:"outside",cliponaxis:false,hovertemplate:"%{x}<br>%{y:.1f} % avec au moins une alerte<extra></extra>"};
  const l=layout("","Trajectoires avec alerte (%)");l.margin={l:58,r:22,t:28,b:42};l.showlegend=false;l.yaxis.range=[0,Math.max(12,...rates.map(r=>100*(r.interval[1]||0)))*1.12];
  l.shapes=[{type:"line",xref:"paper",x0:0,x1:1,y0:5,y1:5,line:{color:"#b15143",width:1.2,dash:"dash"}}];
  l.annotations=[{xref:"paper",x:1,y:5,text:"5 % · cible par méthode valide",showarrow:false,xanchor:"right",yshift:10,font:{size:10,color:"#a14a3e"}}];
  Plotly.react("rates",[trace],l,plotOptions);
  $("mc-table").innerHTML=methods.map(name=>{const r=data.summary[name];return `<tr><td>${label(name)}</td><td>${r.alerts} / ${r.valid_runs}</td><td>${percent(r.rate)}</td><td>${percent(r.interval[0])} – ${percent(r.interval[1])}</td></tr>`;}).join("");
  const skipped=data.summary.plugin.unavailable_runs;$("mc-unavailable").hidden=!skipped;
  $("mc-unavailable").textContent=`IPCW estimé indisponible dans ${skipped} répétition(s). Sa fréquence utilise uniquement les ${data.summary.plugin.valid_runs} répétitions estimables ; ce n'est pas une fréquence sur l'ensemble des scénarios.`;
  $("progress").hidden=true;updateStale();
}
worker.onmessage=({data})=>{
  try {
    if(data.type==="ready"){
      if(!window.Plotly)throw new Error("La bibliothèque de graphiques n'a pas chargé. Vérifie la connexion et recharge la page.");
      ready=true;numpyVersion=data.numpy;$("runtime").textContent=`Python · NumPy ${numpyVersion}`;setBusy(false);submit("trajectory");return;
    }
    if(data.type==="progress"){$("progress").value=data.done/data.total;$("status").textContent=`Répétitions : ${data.done} / ${data.total}`;return;}
    if(data.type==="error"){showError(data.message);$("status").textContent="Calcul interrompu.";return;}
    if(data.type==="trajectory")showTrajectory(data.result);
    if(data.type==="monte_carlo")showMonteCarlo(data.result);
    setBusy(false);$("status").textContent="Calcul terminé. Paramètres et graine conservés.";
  } catch(error){showError(String(error));}
};
worker.onerror=event=>{showError(event.message||"Impossible de charger Python. Vérifie la connexion puis recharge la page.");$("status").textContent="Chargement interrompu.";};
$("parameters").addEventListener("submit",event=>{event.preventDefault();submit("trajectory");});
$("repeat").addEventListener("click",()=>submit("monte_carlo"));
$("parameters").addEventListener("input",updateStale);
$("reset").addEventListener("click",()=>{for(const [k,v] of Object.entries(defaults))$(k).value=v;updateStale();});
document.querySelector("details").addEventListener("toggle",event=>{if(event.target.open)drawCalibration();});
$("export").addEventListener("click",()=>{
  const data={trajectory:run,monte_carlo:mc,numpy_version:numpyVersion};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:"application/json"}));
  const link=document.createElement("a");link.href=url;link.download=`experiment_01_seed_${run.config.seed}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
