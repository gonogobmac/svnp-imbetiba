import React, { useEffect, useMemo, useState } from "react";

// =============================================
// SVNP‑Imbetiba 2.0 — Centro Operacional (rev I)
// =============================================
// Fix: removido fragmento JSX solto após <VesselRow/> que causava SyntaxError.
// Fix: Nota técnica mantida via modal; botão GitHub simplificado para salvar somente vessels.

// ---------------- Constantes/Util ----------------
const RAJADA_TETO = 27; // kn universal
const MAX_LOA = 120; // m
const MAX_DRAFT = 8.4; // m

const ANCH_ZONES = [
  { id: "alpha", label: "Alpha" },
  { id: "bravo", label: "Bravo" },
  { id: "delta", label: "Delta" },
];
const CANAIS = [ { id: "norte", label: "Canal Norte" }, { id: "sul", label: "Canal Sul" } ];
const PIERS = [ { id: "P1", label: "Píer 1" }, { id: "P2", label: "Píer 2" }, { id: "P3", label: "Píer 3" } ];
const SIDES = [ { id: "praia", label: "Lado Praia" }, { id: "mar", label: "Lado Mar" } ];
const BOLLARDS = ["Alfa","Bravo","Charlie","Delta","Echo","Foxtrot"];
const CATALOG_LS_KEY = 'svnp_catalog_v1';

function clsJoin(...a){return a.filter(Boolean).join(' ')}

// Tabela CMR (interpolação linear 0→1.2 m)
const CMR_TABLE = {
  canalSul: { m0: 9.1, m1_2: 10.2 },
  canalNorte: { m0: 8.0, m1_2: 9.1 },
  bacia: { m0: 9.0, m1_2: 10.1 },
  piersNorte: { m0: 8.0, m1_2: 9.1 },
};
function interpCMR(row, mare){ const f=Math.max(0,Math.min(1,(+mare||0)/1.2)); return +(row.m0+(row.m1_2-row.m0)*f).toFixed(2); }

// Regras de Canal (entrada)
const CANAL_LIMITS = {
  A: { hs: 1.5, tp: 12 },
  B: { p3_mar: { hs: 1.5, tp: 12 }, outros: { hs: 2.0, tp: 12 } },
  C: { p3_mar: { hs: 1.5, tp: 12 }, outros: { hs: 2.0, tp: 12 } },
  T: { p1_mar: { hs: 1.5, tp: 12 }, p2_praia: { hs: 1.5, tp: 12 } },
};
function canalRuleFor(category, pierId, sideId){
  if(category==='A') return CANAL_LIMITS.A;
  if(category==='B') return (pierId==='P3'&&sideId==='mar')? CANAL_LIMITS.B.p3_mar : CANAL_LIMITS.B.outros;
  if(category==='C') return (pierId==='P3'&&sideId==='mar')? CANAL_LIMITS.C.p3_mar : CANAL_LIMITS.C.outros;
  if(category==='T'){
    if(pierId==='P1'&&sideId==='mar') return CANAL_LIMITS.T.p1_mar;
    if(pierId==='P2'&&sideId==='praia') return CANAL_LIMITS.T.p2_praia;
    return null;
  }
  return null;
}

function ventoMedioLimite(category,pierId,sideId,vizinhoOcupado){
  if(category==='A') return vizinhoOcupado?15:18;
  if(category==='B') return (pierId==='P3'&&sideId==='mar')?15:27;
  if(category==='C'){
    if(pierId==='P3'&&sideId==='mar') return 15;
    if(pierId==='P3'&&sideId==='praia') return 27;
    return vizinhoOcupado?15:18; // P1/P2
  }
  if(category==='T'){
    if((pierId==='P1'&&sideId==='mar')||(pierId==='P2'&&sideId==='praia')) return vizinhoOcupado?15:18;
    return null;
  }
  return null;
}

// Categoriza automaticamente com base na tabela fornecida
function autoCategory(loa, boa){
  const L = parseFloat(String(loa??'').replace(',','.'));
  const B = parseFloat(String(boa??'').replace(',','.'));
  if(!Number.isFinite(L)||!Number.isFinite(B)) return 'B';
  // Tanque (perfil conhecido ~88×14.8)
  if(Math.abs(L-88.1)<=5 && Math.abs(B-14.82)<=1) return 'T';
  // A: (B>=22 & L>=93) ou (B<22 & L>=95)
  if((B>=22 && L>=93) || (B<22 && L>=95)) return 'A';
  // B: 16<=B<22 & 73<=L<95
  if(B>=16 && B<22 && L>=73 && L<95) return 'B';
  // C: B<16 & L<=90
  if(B<16 && L<=90) return 'C';
  return 'B';
}

// --------------- UI primitives ---------------
const Pill = ({ children, tone='slate', size='md' })=>{
  const tones={slate:'bg-slate-100 text-slate-700 ring-1 ring-slate-200',ok:'bg-emerald-600 text-white',warn:'bg-amber-600 text-white',bad:'bg-rose-600 text-white',info:'bg-blue-600 text-white'};
  const sizes={sm:'text-xs px-2 py-1',md:'text-sm px-3 py-1.5',lg:'text-base px-4 py-2'};
  return <span className={clsJoin('inline-flex items-center rounded-full font-semibold shadow-sm',tones[tone],sizes[size])}>{children}</span>;
};
const Label = ({children,hint})=> (<label className="block text-[13px] font-medium text-slate-700">{children}{hint&&<span className="block text-[11px] font-normal text-slate-500">{hint}</span>}</label>);
const SmallBtn = ({children,onClick,tone='default'})=>{
  const map={default:'bg-slate-100 text-slate-700 hover:bg-slate-200',primary:'bg-blue-600 text-white hover:bg-blue-700',success:'bg-emerald-600 text-white hover:bg-emerald-700',danger:'bg-rose-600 text-white hover:bg-rose-700'};
  return <button onClick={onClick} className={clsJoin('text-sm px-3 py-1.5 rounded-lg shadow-sm',map[tone])}>{children}</button>;
};
const IconBtn = ({title,onClick,children})=> (<button title={title} onClick={onClick} className="w-8 h-8 inline-flex items-center justify-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200">{children??'ℹ︎'}</button>);
const Card = ({title,desc,children,right})=> (
  <div className="bg-white rounded-2xl shadow-sm border border-slate-200/70">
    <div className="flex items-start justify-between p-4 border-b border-slate-100">
      <div><h2 className="font-semibold text-slate-900">{title}</h2>{desc&&<p className="text-xs text-slate-500 mt-0.5">{desc}</p>}</div>
      {right}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

// Texto numérico com parse/clamp no BLUR (corrige inputs meteo e evita travar digitação)
function TextNumber({ value, onCommit, suffix, placeholder }){
  const [txt,setTxt]=useState(value==null?'':String(value));
  useEffect(()=>{ setTxt(value==null?'':String(value)); },[value]);
  return (
    <div className="relative">
      <input type="text" className="w-full border border-slate-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" value={txt} placeholder={placeholder}
        onChange={(e)=> setTxt(e.target.value)}
        onBlur={()=>{
          const n=parseFloat(String(txt).replace(',','.'));
          if(Number.isFinite(n)) onCommit?.(n);
        }} />
      {suffix && <span className="absolute inset-y-0 right-2 flex items-center text-[11px] text-slate-500">{suffix}</span>}
    </div>
  );
}
const NumberInput = (props)=> <TextNumber {...props} />;

// --------------- Tipos básicos ---------------
function emptyMooring(){ return { heads:['Alfa','Bravo'], springs:['Charlie'], stern:['Delta','Echo'], notes:'' }; }

// --------------- Catálogo IO (Export/Import) ---------------
function CatalogIO({ catalog, setCatalog, compact }){
  const fileRef = React.useRef(null);
  const exportJSON = ()=>{
    const blob=new Blob([JSON.stringify(catalog,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download='catalog.json'; a.click(); URL.revokeObjectURL(url);
  };
  const importJSON = (e)=>{
    const f=e.target.files?.[0]; if(!f) return; const r=new FileReader();
    r.onload=()=>{ try{ const data=JSON.parse(String(r.result)); if(Array.isArray(data)){
      const modeMerge = confirm('Importar catálogo: deseja MESCLAR com o atual? (OK = mesclar, Cancelar = substituir)');
      if(modeMerge){
        const map = new Map(catalog.map(it=> [String(it.name).toLowerCase(), {...it}]));
        for(const it of data){ const k=String(it.name||'').toLowerCase(); if(!k) continue; map.set(k, { ...map.get(k), ...it }); }
        setCatalog(Array.from(map.values()));
      } else {
        setCatalog(data);
      }
    } else alert('JSON inválido'); }catch{ alert('Falha ao ler JSON'); } };
    r.readAsText(f);
  };
  return (
    <div className={clsJoin('flex items-center gap-2', compact? '':'mb-0')}>
      <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={importJSON} />
      <SmallBtn onClick={exportJSON}>Exportar catálogo</SmallBtn>
      <SmallBtn onClick={()=>fileRef.current?.click()}>Importar catálogo</SmallBtn>
    </div>
  );
}

// --------------- App ---------------
export default function App(){
  // Modais
  const [catalogOpen,setCatalogOpen]=useState(false);

  // GitHub cfg (para salvar sem pedir dados sempre)
  const GH_LS_KEY='svnp_github_cfg_v1';
  const [ghCfg,setGhCfg]=useState({ owner:'', repo:'', branch:'main', path:'public/catalog.json', pathVessels:'data/vessels.json', token:'' });
  useEffect(()=>{ try{ const r=localStorage.getItem(GH_LS_KEY); if(r){ setGhCfg(JSON.parse(r)); } }catch{} },[]);
  useEffect(()=>{ try{ localStorage.setItem(GH_LS_KEY, JSON.stringify(ghCfg)); }catch{} },[ghCfg]);

  // Catálogo persistente (modelos salvos para autocomplete)
  const [catalog,setCatalog]=useState([]);
  useEffect(()=>{
    try{
      const raw=localStorage.getItem(CATALOG_LS_KEY);
      if(raw){ setCatalog(JSON.parse(raw)); }
      else {
        // opcional: tentar carregar de /catalog.json se existir no repositório (public/)
        fetch('/catalog.json').then(r=> r.ok? r.json(): null).then(d=>{ if(d && Array.isArray(d)) setCatalog(d); }).catch(()=>{});
      }
    }catch{}
  },[]);
  useEffect(()=>{ try{ localStorage.setItem(CATALOG_LS_KEY, JSON.stringify(catalog)); }catch{} },[catalog]);

  // Estado global do ambiente
  const [mare,setMare]=useState(0.6);
  const [hsExt,setHsExt]=useState(1.0);
  const [tpExt,setTpExt]=useState(10);
  const [ventoInt,setVentoInt]=useState(12);
  const [rajadaInt,setRajadaInt]=useState(18);
  const [hsInt,setHsInt]=useState(0.8);
  const [tpInt,setTpInt]=useState(10.5);

  // Frota
  const [vessels,setVessels]=useState([]);
  const [selected,setSelected]=useState(null);
  const [noteOpen,setNoteOpen]=useState(false);
  const [noteText,setNoteText]=useState('');

  // Canais reservados / ocupados
  const [canalUse,setCanalUse]=useState({ norte:null, sul:null });

  // Modal novo
  const [newOpen,setNewOpen]=useState(false);
  const [newDraft,setNewDraft]=useState({ name:'', loa:'', boa:'', draft:'', anchorZone:'alpha' });
  const namePick = (val)=>{
    const t = catalog.find(x=> String(x.name).toLowerCase()===String(val).toLowerCase());
    setNewDraft(prev=>{
      const next = { ...prev, name: val };
      if(t){
        next.loa = t.loa ?? '';
        next.boa = t.boa ?? '';
        next.draft = t.draft ?? '';
        next.anchorZone = prevAnchorZoneSafe(t.anchorZone);
      }
      return next;
    });
  };
  function prevAnchorZoneSafe(z){ return ['alpha','bravo','delta'].includes(String(z))? z : 'alpha'; }

  // Contadores topo
  const counts = useMemo(()=>{
    const inZone = { alpha:0, bravo:0, delta:0 };
    vessels.forEach(v=>{ if(v.state==='anchored') inZone[v.anchorZone]++; });
    return inZone;
  },[vessels]);

  // --------- Decisor resumido (usa ambiente global + dados do navio/berço) ---------
  function decideFor(v){
    // NAV: canal Hs×Tp + CMR + restrições categoria/berço
    let navOK=true; const navFails=[];
    const rule = canalRuleFor(v.category, v.pier, v.side);
    if(v.category==='A' && v.pier==='P3' && v.side==='mar'){ navOK=false; navFails.push('Cat. A não autorizado em P3-mar'); }
    if(v.category==='T' && !((v.pier==='P1' && v.side==='mar')||(v.pier==='P2'&&v.side==='praia'))){ navOK=false; navFails.push('Tanque somente em P1-mar ou P2-praia'); }
    if(rule){ if(!(hsExt<=rule.hs && tpExt<=rule.tp)){ navOK=false; navFails.push(`Canal Hs×Tp excedido (lim ${rule.hs} m / ${rule.tp} s)`); } }
    else { navOK=false; navFails.push('Sem regra de canal aplicável'); }
    const cmrCanal = v.canalPref==='sul'? interpCMR(CMR_TABLE.canalSul,mare) : interpCMR(CMR_TABLE.canalNorte,mare);
    const cmrBacia = interpCMR(CMR_TABLE.bacia,mare);
    const cmrPier  = interpCMR(CMR_TABLE.piersNorte,mare);
    const cmrMin = Math.min(cmrCanal,cmrBacia,cmrPier);
    if(parseFloat(v.draft||0) > cmrMin){ navOK=false; navFails.push(`CMR insuficiente: calado ${v.draft} m > ${cmrMin} m`);}    

    // PERM: vento/rajada + ondas internas (usa limites on-berth presets simplificados)
    let perOK=true; const perFails=[];
    const vmLim = ventoMedioLimite(v.category,v.pier,v.side,!!v.neighborBusy);
    const worstVm = Math.max(ventoInt, 0);
    if(vmLim==null){ perOK=false; perFails.push('Berço não aplicável para a categoria'); }
    else if(worstVm>vmLim){ perOK=false; perFails.push(`Vento médio ${worstVm} kn > ${vmLim} kn`);}    
    if(Math.max(rajadaInt,0)>RAJADA_TETO){ perOK=false; perFails.push(`Rajada ${rajadaInt} kn > teto ${RAJADA_TETO} kn`);}    
    // On-berth simplificado: P1/P1P limites agregados conforme categoria
    const lim = (v.category==='A')? { hs:1.2, tp:12 } : (v.category==='B')? { hs:2.0, tp:12 } : (v.category==='C')? { hs:2.4, tp:12 } : { hs:1.5, tp:12 };
    if(!(hsInt<=lim.hs && tpInt<=lim.tp)){ perOK=false; perFails.push(`On-berth interno Hs×Tp excedido (lim ${lim.hs} m / ${lim.tp} s)`);}    

    let status = (navOK && perOK)? 'Go' : 'No-Go';
    if(status==='Go'){
      const near=[];
      if(rule && (Math.abs(rule.hs-hsExt)<=0.1 || Math.abs(rule.tp-tpExt)<=0.5)) near.push('Canal próximo do limite');
      if(Math.abs(lim.hs-hsInt)<=0.1 || Math.abs(lim.tp-tpInt)<=0.5) near.push('On-berth próximo do limite');
      if(near.length) status='Go com restrição';
    }
    return { status, navOK, navFails, perOK, perFails, cmr:{ canal:cmrCanal, bacia:cmrBacia, pier:cmrPier, minimo:cmrMin } };
  }

  // --------- Nota técnica automática ---------
  function buildNotaTecnica(v,dec){
    const dt = new Date().toLocaleString();
    const linhas = [];
    linhas.push(`NOTA TÉCNICA — ${v.name}`);
    linhas.push(`Data/Hora: ${dt}`);
    linhas.push(`Situação: ${dec.status}`);
    linhas.push('Resumo meteoceanográfico:');
    linhas.push(`  Externo: Hs=${hsExt} m, Tp=${tpExt} s`);
    linhas.push(`  Interno: Hs=${hsInt} m, Tp=${tpInt} s, Vento=${ventoInt} kn, Rajada=${rajadaInt} kn (teto=${RAJADA_TETO} kn)`);
    linhas.push(`  Maré=${mare} m | CMR(min)=${dec.cmr.minimo} m (Canal ${dec.cmr.canal} / Bacia ${dec.cmr.bacia} / Píer ${dec.cmr.pier})`);
    if(!dec.navOK){ linhas.push('Falhas de Navegação:'); dec.navFails.forEach(f=>linhas.push(`  - ${f}`)); }
    if(!dec.perOK){ linhas.push('Falhas de Permanência:'); dec.perFails.forEach(f=>linhas.push(`  - ${f}`)); }
    linhas.push('Recomendação:');
    if(dec.status==='No-Go'){
      if(!dec.navOK && !dec.perOK) linhas.push('  • Desaconselha-se entrada e permanência. Avaliar aguardar melhora ou saída segura.');
      else if(!dec.navOK) linhas.push('  • Desaconselha-se a navegação/entrada neste momento.');
      else linhas.push('  • Desaconselha-se a permanência atracada neste momento.');
    } else if(dec.status==='Go com restrição') {
      linhas.push('  • Proceder com restrições: reforço de amarração, tugs stand-by, vigilância de rajadas/onda, pausas de convés conforme necessário.');
    } else {
      linhas.push('  • Operação recomendada conforme critérios vigentes.');
    }
    return linhas.join('\n');
  }

  // --------- Handlers básicos ---------
  function addVessel(){ setNewOpen(true); }
  function saveNewVessel(){
    const L=parseFloat(String(newDraft.loa).replace(',','.'));
    const D=parseFloat(String(newDraft.draft).replace(',','.'));
    if(!newDraft.name.trim()){ alert('Informe o nome da embarcação.'); return; }
    if(!Number.isFinite(L) || L>MAX_LOA){ alert(`LOA inválido. Máx ${MAX_LOA} m.`); return; }
    if(!Number.isFinite(D) || D>MAX_DRAFT){ alert(`Calado inválido. Máx ${MAX_DRAFT} m.`); return; }
    const cat = autoCategory(newDraft.loa, newDraft.boa);
    const id=Math.random().toString(36).slice(2,9);
    const v={ id, name:newDraft.name.trim(), category:cat, loa:newDraft.loa, boa:newDraft.boa, draft:newDraft.draft, anchorZone:newDraft.anchorZone, state:'anchored', canalPref:'norte', pier:'P1', side:'praia', arranjo:1, neighborBusy:false, mooring:emptyMooring(), contrabordo:false };
    setVessels(prev=>[...prev,v]); setSelected(id);
    // atualizar/registrar no catálogo persistente
    setCatalog(prev=>{
      const idx = prev.findIndex(x=> String(x.name).toLowerCase()===v.name.toLowerCase());
      const entry = { name:v.name, loa:v.loa, boa:v.boa, draft:v.draft, category:v.category };
      if(idx>=0){ const clone=[...prev]; clone[idx]=entry; return clone; }
      return [...prev, entry];
    });
    setNewOpen(false); setNewDraft({ name:'', loa:'', boa:'', draft:'', anchorZone:'alpha' });
  }

  function setVessel(id, patch){ setVessels(prev=> prev.map(x=> x.id===id? {...x, ...patch}: x)); }

  // Canal reserva lógica (1 por canal; entrada e saída podem coexistir em canais distintos)
  function reserveCanal(canalId, vesselId){
    setCanalUse(prev=>{ if(prev[canalId] && prev[canalId]!==vesselId){ alert(`Canal ${canalId} já ocupado.`); return prev; } return {...prev, [canalId]:vesselId}; });
    setVessel(vesselId,{ canalPref: canalId });
  }
  function freeCanal(canalId){ setCanalUse(prev=>({...prev,[canalId]:null})); }

  // Atracação finalizando trânsito — 1 por píer (controle contra-bordo)
  function finalizeBerth(v){
    const samePier = vessels.filter(o=> o.state==='berthed' && o.pier===v.pier);
    if(samePier.length>=1){
      if(!confirm('Já existe embarcação no píer. Deseja atracar a contra-bordo?')) return;
      setVessel(v.id,{ state:'berthed', contrabordo:true });
    } else {
      setVessel(v.id,{ state:'berthed', contrabordo:false });
    }
    if(canalUse[v.canalPref]===v.id) freeCanal(v.canalPref);
  }

  // ---------- Componentes ----------
  const AnchTopCounters = ()=> (
    <div className="grid grid-cols-3 gap-3">
      {ANCH_ZONES.map(z=> (
        <div key={z.id} className="bg-slate-50 border rounded-xl p-3 flex items-center justify-between">
          <div className="text-sm text-slate-600">{z.label}</div>
          <Pill tone="info" size="lg">{counts[z.id]}</Pill>
        </div>
      ))}
    </div>
  );

  const MeteoCard = ()=> (
    <Card title="Meteo & Hidro (Global)" desc="Externo e Interno; maré aplicada ao CMR">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        <div className="md:col-span-3"><Label>Maré</Label><NumberInput value={mare} onCommit={setMare} suffix="m" /></div>
        <div className="md:col-span-9 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border rounded-xl p-3">
            <div className="font-medium text-slate-800 mb-2">Externo (Canal)</div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Hs</Label><NumberInput value={hsExt} onCommit={setHsExt} suffix="m" /></div>
              <div><Label>Tp</Label><NumberInput value={tpExt} onCommit={setTpExt} suffix="s" /></div>
            </div>
          </div>
          <div className="border rounded-xl p-3">
            <div className="font-medium text-slate-800 mb-2">Interno (Porto)</div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Hs</Label><NumberInput value={hsInt} onCommit={setHsInt} suffix="m" /></div>
              <div><Label>Tp</Label><NumberInput value={tpInt} onCommit={setTpInt} suffix="s" /></div>
              <div><Label>Vento</Label><NumberInput value={ventoInt} onCommit={setVentoInt} suffix="kn" /></div>
              <div><Label>Rajada</Label><NumberInput value={rajadaInt} onCommit={setRajadaInt} suffix="kn" /></div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );

  const NewVesselModal = ()=> (
    <Modal open={newOpen} onClose={()=>setNewOpen(false)} title="Cadastrar embarcação">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><Label>Nome</Label>
          <input list="vesselCatalog" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={newDraft.name} onChange={e=>namePick(e.target.value)} placeholder="Digite o nome ou selecione"/>
          <datalist id="vesselCatalog">
            {catalog.map(t=> <option key={t.name} value={t.name} />)}
          </datalist>
        </div>
        <div><Label>Comprimento (LOA)</Label><NumberInput value={newDraft.loa} onCommit={v=>setNewDraft({...newDraft,loa:v})} suffix="m"/></div>
        <div><Label>Boca (BOA)</Label><NumberInput value={newDraft.boa} onCommit={v=>setNewDraft({...newDraft,boa:v})} suffix="m"/></div>
        <div><Label>Calado</Label><NumberInput value={newDraft.draft} onCommit={v=>setNewDraft({...newDraft,draft:v})} suffix="m"/></div>
        <div>
          <Label>Área de Fundeio</Label>
          <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={newDraft.anchorZone} onChange={e=>setNewDraft({...newDraft,anchorZone:e.target.value})}>
            {ANCH_ZONES.map(z=><option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <div className="text-xs text-slate-500 mb-2">Presets rápidos</div>
          <div className="flex flex-wrap gap-2">
            <SmallBtn onClick={()=>setNewDraft(d=>({ ...d, loa:75, boa:18, draft:6 }))}>PSV padrão</SmallBtn>
            <SmallBtn onClick={()=>setNewDraft(d=>({ ...d, loa:82.4, boa:21, draft:7 }))}>AHTS 18k</SmallBtn>
            <SmallBtn onClick={()=>setNewDraft(d=>({ ...d, loa:88.1, boa:14.82, draft:6.5 }))}>Tanque pequeno</SmallBtn>
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <CatalogIO catalog={catalog} setCatalog={setCatalog} />
        <div className="flex items-center gap-2">
          <SmallBtn onClick={()=>setNewOpen(false)}>Cancelar</SmallBtn>
          <SmallBtn tone="primary" onClick={saveNewVessel}>Salvar</SmallBtn>
        </div>
      </div>
    </Modal>
  );

  const VesselRow = ({v})=>{
    const [open,setOpen]=useState(false);
    const dec = useMemo(()=>decideFor(v), [v, mare, hsExt,tpExt,hsInt,tpInt,ventoInt,rajadaInt]);
    return (
      <div className="border rounded-xl p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Pill tone={dec.status==='Go'?'ok':dec.status==='Go com restrição'?'warn':'bad'}>{dec.status}</Pill>
            <div className="font-semibold text-slate-800">{v.name}</div>
            <Pill tone="info" size="sm">{v.category}</Pill>
          </div>
          <div className="flex items-center gap-2">
            <IconBtn title="Detalhes" onClick={()=>setOpen(!open)}>ℹ︎</IconBtn>
          </div>
        </div>
        {open && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="space-y-2">
              <div className="text-slate-600">LOA {v.loa} m · BOA {v.boa} m · Calado {v.draft} m</div>
              <div className="text-slate-600">Estado: {v.state} · Fundeio: {v.anchorZone?.toUpperCase()}</div>
              <div className="text-slate-600">Destino: {v.pier}/{v.side}</div>
              <div className="flex gap-2 flex-wrap">
                {v.state==='anchored' && <SmallBtn tone="primary" onClick={()=>setVessel(v.id,{ state:'queued' })}>Chamar para atracação</SmallBtn>}
                {v.state==='queued' && (
                  <>
                    <select className="border rounded-lg px-2 py-1 text-sm" value={v.canalPref} onChange={e=>reserveCanal(e.target.value,v.id)}>{CANAIS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select>
                    <select className="border rounded-lg px-2 py-1 text-sm" value={v.pier} onChange={e=>setVessel(v.id,{ pier:e.target.value })}>{PIERS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select>
                    <select className="border rounded-lg px-2 py-1 text-sm" value={v.side} onChange={e=>setVessel(v.id,{ side:e.target.value })}>{SIDES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select>
                    <SmallBtn tone="success" onClick={()=>setVessel(v.id,{ state:'transiting' })}>Autorizar entrada</SmallBtn>
                  </>
                )}
                {v.state==='transiting' && (
                  <>
                    <SmallBtn tone="success" onClick={()=>finalizeBerth(v)}>Finalizar atracação</SmallBtn>
                    <SmallBtn onClick={()=>{ if(canalUse[v.canalPref]===v.id) freeCanal(v.canalPref); setVessel(v.id,{ state:'anchored' }); }}>Cancelar</SmallBtn>
                  </>
                )}
                {v.state==='berthed' && (
                  <>
                    <SmallBtn onClick={()=>setVessel(v.id,{ state:'departing' })}>Preparar saída</SmallBtn>
                  </>
                )}
                {v.state==='departing' && (
                  <>
                    <select className="border rounded-lg px-2 py-1 text-sm" value={v.canalPref} onChange={e=>reserveCanal(e.target.value,v.id)}>{CANAIS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select>
                    <SmallBtn tone="danger" onClick={()=>{ if(canalUse[v.canalPref]===v.id) freeCanal(v.canalPref); setVessel(v.id,{ state:'done' }); }}>Zarpar</SmallBtn>
                  </>
                )}
                {dec.status==='No-Go' ? (
                  <SmallBtn tone="danger" onClick={()=>{ const nota=buildNotaTecnica(v,dec); setNoteText(nota); setNoteOpen(true); }}>Nota técnica</SmallBtn>
                ) : (
                  <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-200 text-slate-600 cursor-not-allowed select-none">Nota técnica</span>
                )}
              </div>
            </div>
            <div className="space-y-1 text-xs text-slate-600">
              {!dec.navOK && (<div className="text-rose-700"><b>Navegação NÃO OK:</b><ul className="list-disc pl-5">{dec.navFails.map((f,i)=><li key={i}>{f}</li>)}</ul></div>)}
              {!dec.perOK && (<div className="text-rose-700"><b>Permanência NÃO OK:</b><ul className="list-disc pl-5">{dec.perFails.map((f,i)=><li key={i}>{f}</li>)}</ul></div>)}
              {dec.navOK && dec.perOK && <div><b>Critérios atendidos.</b></div>}
            </div>
          </div>
        )}
      </div>
    );
  };

  const AnchorageBoard = ()=> (
    <Card title="Fundeios" desc="Gerencie embarcações em Alpha, Bravo e Delta">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {ANCH_ZONES.map(z=> (
          <div key={z.id} className="bg-slate-50 border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2"><div className="font-semibold">{z.label}</div><Pill tone="info">{counts[z.id]}</Pill></div>
            <div className="space-y-2">
              {vessels.filter(v=>v.state==='anchored' && v.anchorZone===z.id).map(v=> (<VesselRow key={v.id} v={v}/>))}
              {vessels.filter(v=>v.state==='anchored' && v.anchorZone===z.id).length===0 && <div className="text-xs text-slate-500">Sem embarcações.</div>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );

  const QueueBoard = ()=> (
    <Card title="Chamadas para Atracação" desc="Fila e reserva de canais">
      <div className="space-y-2">
        {vessels.filter(v=>v.state==='queued'||v.state==='transiting').map(v=> (<VesselRow key={v.id} v={v}/>))}
        {vessels.filter(v=>v.state==='queued'||v.state==='transiting').length===0 && <div className="text-xs text-slate-500">Nenhuma embarcação na fila.</div>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        {CANAIS.map(c=> (
          <div key={c.id} className="border rounded-xl p-3 flex items-center justify-between"><div>{c.label}</div><Pill tone={canalUse[c.id]? 'warn':'ok'}>{canalUse[c.id]? 'Ocupado':'Livre'}</Pill></div>
        ))}
      </div>
    </Card>
  );

  const NoteModal = ()=> (
    <Modal open={noteOpen} onClose={()=>setNoteOpen(false)} title="Nota técnica">
      <div className="space-y-3">
        <textarea readOnly className="w-full h-56 border rounded-lg p-2 text-sm font-mono" value={noteText} />
        <div className="flex items-center justify-end gap-2">
          <SmallBtn onClick={()=>{ navigator.clipboard?.writeText(noteText); alert('Nota copiada.'); }}>Copiar</SmallBtn>
          <SmallBtn tone="primary" onClick={()=>setNoteOpen(false)}>Fechar</SmallBtn>
        </div>
      </div>
    </Modal>
  );

  const PiersBoard = ()=> (
    <Card title="Píeres" desc="Estado atual dos berços">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PIERS.map(p=> (
          <div key={p.id} className="bg-slate-50 border rounded-xl p-3">
            <div className="font-semibold mb-2">{p.label}</div>
            <div className="space-y-2">
              {vessels.filter(v=>v.state==='berthed' && v.pier===p.id).map(v=> (<VesselRow key={v.id} v={v}/>))}
              {vessels.filter(v=>v.state==='berthed' && v.pier===p.id).length===0 && <div className="text-xs text-slate-500">Vazio</div>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );

  const HeaderBar = ()=> {
    const overall = useMemo(()=>{
      const sample = vessels.filter(v=> ['queued','transiting','berthed'].includes(v.state));
      if(sample.length===0) return 'Go';
      let hasWarn=false; for(const v of sample){ const d=decideFor(v); if(d.status==='No-Go') return 'No-Go'; if(d.status==='Go com restrição') hasWarn=true; }
      return hasWarn? 'Go com restrição':'Go';
    },[vessels, mare, hsExt,tpExt,hsInt,tpInt,ventoInt,rajadaInt]);

    async function quickGithubSave(){
      const {owner,repo,branch,pathVessels,token}=ghCfg||{};
      if(!owner||!repo||!pathVessels||!token){
        alert('Configure o GitHub (owner/repo/path/token) antes de salvar.');
        return;
      }
      try{
        const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(pathVessels)}`;
        // obter sha (se existir)
        let sha=null; try{ const r=await fetch(api+`?ref=${encodeURIComponent(branch||'main')}`); if(r.ok){ const j=await r.json(); sha=j.sha; } }catch{}
        const payload = { vessels };
        const content = btoa(unescape(encodeURIComponent(JSON.stringify(payload,null,2))));
        const put = await fetch(api,{ method:'PUT', headers:{ 'Authorization':`Bearer ${token}`, 'Content-Type':'application/json' }, body: JSON.stringify({ message:`chore: update vessels (${new Date().toISOString()})`, branch:branch||'main', content, sha }) });
        if(!put.ok){ const t=await put.text(); throw new Error(t); }
        alert('Dados das embarcações salvos no GitHub com sucesso.');
      }catch(e){ alert('Falha ao salvar no GitHub: '+(e?.message||e)); }
    }

    return (
      <div className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg md:text-2xl font-bold text-slate-900">SVNP‑Imbetiba</h1>
            <span className="hidden md:inline-block text-xs text-slate-500">Centro Operacional · v2.0</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <SmallBtn onClick={()=>setCatalogOpen(true)}>Gerir catálogo</SmallBtn>
            <SmallBtn tone="primary" onClick={quickGithubSave}>Salvar dados (GitHub)</SmallBtn>
            <CatalogIO catalog={catalog} setCatalog={setCatalog} compact />
            <SmallBtn tone="primary" onClick={addVessel}>+ Adicionar embarcação</SmallBtn>
            <Pill size="lg" tone={overall==='Go'?'ok':overall==='Go com restrição'?'warn':'bad'}>{overall}</Pill>
          </div>
        </div>
      </div>
    );
  };

  // --------------- Render ---------------
  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar />
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        <AnchTopCounters />
        {/* Fundeios e Píeres logo após os contadores */}
        <AnchorageBoard />
        <PiersBoard />
        {/* Meteo depois dos quadros operacionais de posição */}
        <MeteoCard />
        {/* Fila de atracação e canais */}
        <QueueBoard />
      </div>
      <NewVesselModal />
      <NoteModal />
      {catalogOpen && <CatalogManagerModal onClose={()=>setCatalogOpen(false)} catalog={catalog} setCatalog={setCatalog} />}
    </div>
  );
}

// --------------- Catálogo: edição direta ---------------
function CatalogManagerModal({ onClose, catalog, setCatalog }){
  const [rows,setRows]=useState(catalog.map((r,i)=>({ ...r, _id: i })));
  useEffect(()=>{ setRows(catalog.map((r,i)=>({ ...r, _id: i }))); },[catalog]);
  const addRow=()=> setRows(prev=>[...prev,{ _id: Math.random().toString(36).slice(2,7), name:'', loa:'', boa:'', draft:'', category:'B' }]);
  const delRow=(rid)=> setRows(prev=> prev.filter(r=> r._id!==rid));
  const saveAll=()=>{
    // normaliza e salva
    const out = rows.filter(r=> String(r.name).trim()).map(r=> ({ name:String(r.name).trim(), loa:r.loa, boa:r.boa, draft:r.draft, category:r.category }));
    setCatalog(out); onClose();
  };
  return (
    <Modal open={true} onClose={onClose} title="Gerir catálogo de embarcações">
      <div className="space-y-3">
        <div className="text-xs text-slate-500">Edite diretamente os modelos salvos. Estas alterações atualizam a base local imediatamente ao salvar.</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-600">
                <th className="py-2 pr-3">Nome</th>
                <th className="py-2 pr-3">LOA</th>
                <th className="py-2 pr-3">BOA</th>
                <th className="py-2 pr-3">Calado</th>
                <th className="py-2 pr-3">Categoria</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r=> (
                <tr key={r._id} className="border-t">
                  <td className="py-2 pr-3"><input className="border rounded px-2 py-1 w-full" value={r.name} onChange={e=> setRows(rows=> rows.map(x=> x._id===r._id? {...x,name:e.target.value}:x))} /></td>
                  <td className="py-2 pr-3"><input className="border rounded px-2 py-1 w-24" value={r.loa} onChange={e=> setRows(rows=> rows.map(x=> x._id===r._id? {...x,loa:e.target.value}:x))} /></td>
                  <td className="py-2 pr-3"><input className="border rounded px-2 py-1 w-24" value={r.boa} onChange={e=> setRows(rows=> rows.map(x=> x._id===r._id? {...x,boa:e.target.value}:x))} /></td>
                  <td className="py-2 pr-3"><input className="border rounded px-2 py-1 w-24" value={r.draft} onChange={e=> setRows(rows=> rows.map(x=> x._id===r._id? {...x,draft:e.target.value}:x))} /></td>
                  <td className="py-2 pr-3">
                    <select className="border rounded px-2 py-1" value={r.category} onChange={e=> setRows(rows=> rows.map(x=> x._id===r._id? {...x,category:e.target.value}:x))}>
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                      <option value="T">T</option>
                    </select>
                  </td>
                  <td className="py-2 pr-3 text-right"><SmallBtn onClick={()=>delRow(r._id)}>Remover</SmallBtn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between">
          <SmallBtn onClick={addRow}>+ Adicionar linha</SmallBtn>
          <div className="flex items-center gap-2">
            <SmallBtn onClick={onClose}>Cancelar</SmallBtn>
            <SmallBtn tone="primary" onClick={saveAll}>Salvar alterações</SmallBtn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// --------------- Modal infra ---------------
function Modal({ open, onClose, title, children }){
  if(!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-[min(760px,95vw)]">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
