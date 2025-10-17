import React, { useMemo, useState } from "react";

/**
 * SVNP‑Imbetiba — DECISOR (v0.92)
 * --------------------------------
 * Funcional + layout aprovado + "base limpa" nos parâmetros para consulta:
 * - Inputs numéricos iniciam vazios (""), sem valores predefinidos.
 * - Coerção numérica segura no motor de decisão (vazio ⇒ 0) para não quebrar cálculos.
 * - Mantém regras: NPCP sempre ativo, CMR por maré (gate), matriz Hs×Tp, rajada 27 kn, pior caso de vento.
 * - Layout: Decisão Geral no topo; 1ª linha: Meteo & Hidro (esq) + Navio/Berço/Canal/Maré (dir); 2ª linha: Navegação & Permanência.
 */

// ---------- UI utilitários ----------
const Card = ({ title, desc, children, right }) => (
  <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60">
    <div className="flex items-start justify-between p-4 border-b border-slate-100">
      <div>
        <h2 className="font-semibold text-slate-900">{title}</h2>
        {desc && <p className="text-xs text-slate-500 mt-0.5">{desc}</p>}
      </div>
      {right}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

const Pill = ({ children, tone = "slate", size = "md" }) => {
  const tones = {
    slate: "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200",
    ok: "bg-emerald-600 text-white ring-1 ring-emerald-700/20",
    warn: "bg-amber-600 text-white ring-1 ring-amber-700/20",
    bad: "bg-rose-600 text-white ring-1 ring-rose-700/20",
    info: "bg-blue-600 text-white ring-1 ring-blue-700/20",
  };
  const sizes = { sm: "text-xs px-2 py-1", md: "text-sm px-3 py-1.5", lg: "text-base px-4 py-2" };
  return <span className={`inline-flex items-center rounded-full font-semibold shadow-sm ${tones[tone]} ${sizes[size]}`}>{children}</span>;
};

const Label = ({ children, hint }) => (
  <label className="block text-[13px] font-medium text-slate-700">
    {children}
    {hint && <span className="block text-[11px] font-normal text-slate-500">{hint}</span>}
  </label>
);

const NumberInput = ({ value, onChange, step = 1, suffix, min, max, placeholder }) => (
  <div className="relative">
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      className="w-full border border-slate-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
      value={value === undefined || value === null ? "" : value}
      placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "" || v === null) { onChange(""); return; }
        const n = parseFloat(v);
        onChange(Number.isFinite(n) ? n : "");
      }}
    />
    {suffix && <span className="absolute inset-y-0 right-2 flex items-center text-[11px] text-slate-500">{suffix}</span>}
  </div>
);

// ---------- Catálogos ----------
const PIERS = [ { id: "P1", label: "Píer 1" }, { id: "P2", label: "Píer 2" }, { id: "P3", label: "Píer 3" } ];
const SIDES = [ { id: "praia", label: "Lado Praia" }, { id: "mar", label: "Lado Mar" } ];
const CATEGORIES = [
  { id: "A", label: "Categoria A" },
  { id: "B", label: "Categoria B (generalizada)" },
  { id: "C", label: "Categoria C" },
  { id: "TANQUE", label: "Navio Tanque" },
];
const CANAIS = [ { id: "norte", label: "Canal Norte" }, { id: "sul", label: "Canal Sul" } ];

// ---------- Regras fixas ----------
const RAJADA_TETO = 27; // kn universal

// Limites de canal (entrada) — matriz Hs×Tp (operador E)
const CANAL_LIMITS = {
  A: { hs: 1.5, tp: 12 },
  B: { p3_mar: { hs: 1.5, tp: 12 }, outros: { hs: 2.0, tp: 12 } },
  C: { p3_mar: { hs: 1.5, tp: 12 }, outros: { hs: 2.0, tp: 12 } },
  TANQUE: { p1_mar: { hs: 1.5, tp: 12 }, p2_praia: { hs: 1.5, tp: 12 } },
};

// CMR por maré (interpolação linear 0.0→1.2 m)
const CMR_TABLE = {
  canalSul: { m0: 9.1, m1_2: 10.2 },
  canalNorte: { m0: 8.0, m1_2: 9.1 },
  bacia: { m0: 9.0, m1_2: 10.1 },
  piersNorte: { m0: 8.0, m1_2: 9.1 },
};
function interpCMR(row, mare) {
  const f = Math.max(0, Math.min(1, mare / 1.2));
  return +(row.m0 + (row.m1_2 - row.m0) * f).toFixed(2);
}

// Limites on‑berth (P1 & P1P) — presets fornecidos (resumo consolidado)
const PRESETS_ON_BERTH = {
  A: {
    "P1-praia": { 1: { P1: { tp: 12.2, hs: 1.12 }, P1P: { tp: 12.2, hs: 0.09 } }, 2: { P1: { tp: 11.4, hs: 1.19 }, P1P: { tp: 11.4, hs: 0.09 } } },
    "P1-mar": { 1: { P1: { tp: 12.4, hs: 1.17 }, P1P: { tp: 12.4, hs: 0.09 } }, 2: { P1: { tp: 11.8, hs: 1.20 }, P1P: { tp: 11.8, hs: 0.09 } } },
    "P3-praia": { 1: { P1: { tp: 14.5, hs: 3.73 }, P1P: { tp: 14.5, hs: 0.20 } }, 2: { P1: { tp: 20.4, hs: 3.77 }, P1P: { tp: 20.4, hs: 0.25 } }, 3: { P1: { tp: 14.5, hs: 3.73 }, P1P: { tp: 14.5, hs: 0.20 } }, 4: { P1: { tp: 14.7, hs: 2.83 }, P1P: { tp: 14.7, hs: 0.19 } } },
  },
  B: {
    "P1-praia": { 1: { P1: { tp: 16.9, hs: 2.39 }, P1P: { tp: 16.9, hs: 0.17 } }, 2: { P1: { tp: 9.3, hs: 1.04 }, P1P: { tp: 9.3, hs: 0.08 } } },
    "P1-mar": { 1: { P1: { tp: 20.4, hs: 3.77 }, P1P: { tp: 20.4, hs: 0.25 } }, 2: { P1: { tp: 10.5, hs: 1.10 }, P1P: { tp: 10.5, hs: 0.09 } } },
    "P2-praia": { 1: { P1: { tp: 20.4, hs: 3.77 }, P1P: { tp: 20.4, hs: 0.25 } }, 2: { P1: { tp: 11.6, hs: 2.74 }, P1P: { tp: 11.6, hs: 0.20 } } },
    "P2-mar": { 1: { P1: { tp: 20.4, hs: 3.77 }, P1P: { tp: 20.4, hs: 0.25 } }, 2: { P1: { tp: 13.5, hs: 2.44 }, P1P: { tp: 13.5, hs: 0.20 } } },
    "P3-praia": { 1: { P1: { tp: 20.4, hs: 3.77 }, P1P: { tp: 20.4, hs: 0.25 } }, 2: { P1: { tp: 20.4, hs: 3.77 }, P1P: { tp: 20.4, hs: 0.25 } } },
    "P3-mar": { 1: { P1: { tp: 20.4, hs: 3.77 }, P1P: { tp: 20.4, hs: 0.25 } }, 2: { P1: { tp: 14.5, hs: 1.15 }, P1P: { tp: 14.5, hs: 0.09 } } },
  },
  C: {
    "P1-praia": { 1: { P1: { tp: 11.9, hs: 1.05 }, P1P: { tp: 11.9, hs: 0.08 } }, 2: { P1: { tp: 20.4, hs: 3.77 }, P1P: { tp: 20.4, hs: 0.25 } } },
    "P1-mar": { 1: { P1: { tp: 15.0, hs: 2.48 }, P1P: { tp: 15.0, hs: 0.17 } }, 2: { P1: { tp: 12.8, hs: 2.38 }, P1P: { tp: 12.8, hs: 0.16 } } },
    "P2-praia": { 1: { P1: { tp: 14.6, hs: 2.39 }, P1P: { tp: 14.6, hs: 0.19 } }, 2: { P1: { tp: 20.4, hs: 3.77 }, P1P: { tp: 20.4, hs: 0.25 } } },
    "P2-mar": { 1: { P1: { tp: 20.4, hs: 3.77 }, P1P: { tp: 20.4, hs: 0.25 } }, 2: { P1: { tp: 20.4, hs: 3.77 }, P1P: { tp: 20.4, hs: 0.25 } } },
  },
};

// ---------- Helpers ----------
function keyPierSide(pierId, sideId) { return `${pierId}-${sideId}`; }
function minPairCorrect(a, b) { return { tp: Math.min(a.tp, b.tp), hs: Math.min(a.hs, b.hs) }; }

function canalRuleFor(category, pierId, sideId) {
  if (category === "A") return CANAL_LIMITS.A;
  if (category === "B") return (pierId === "P3" && sideId === "mar") ? CANAL_LIMITS.B.p3_mar : CANAL_LIMITS.B.outros;
  if (category === "C") return (pierId === "P3" && sideId === "mar") ? CANAL_LIMITS.C.p3_mar : CANAL_LIMITS.C.outros;
  if (category === "TANQUE") {
    if (pierId === "P1" && sideId === "mar") return CANAL_LIMITS.TANQUE.p1_mar;
    if (pierId === "P2" && sideId === "praia") return CANAL_LIMITS.TANQUE.p2_praia;
    return null;
  }
  return null;
}

function ventoMedioLimite(category, pierId, sideId, vizinhoOcupado) {
  if (category === "A") return vizinhoOcupado ? 15 : 18;
  if (category === "B") return (pierId === "P3" && sideId === "mar") ? 15 : 27;
  if (category === "C") {
    if (pierId === "P3" && sideId === "mar") return 15;
    if (pierId === "P3" && sideId === "praia") return 27;
    return vizinhoOcupado ? 15 : 18; // P1/P2
  }
  if (category === "TANQUE") {
    if ((pierId === "P1" && sideId === "mar") || (pierId === "P2" && sideId === "praia")) return vizinhoOcupado ? 15 : 18;
    return null;
  }
  return null;
}

// ---------- App ----------
export default function App() {
  // Navio / operação (inputs "limpos")
  const [category, setCategory] = useState("A");
  const [loa, setLoa] = useState("");
  const [boa, setBoa] = useState("");
  const [calado, setCalado] = useState("");
  const [isAHTS18k, setIsAHTS18k] = useState(false);

  // Berço
  const [pier, setPier] = useState("P1");
  const [side, setSide] = useState("praia");
  const [arranjo, setArranjo] = useState(1);
  const [vizinhoOcupado, setVizinhoOcupado] = useState(false);
  const [distCostadosOK, setDistCostadosOK] = useState(true); // ≥10 m com vizinho

  // Meteo/Hidro (grupo único de sensores) — inputs limpos
  const [canalAcesso, setCanalAcesso] = useState("norte");
  const [mare, setMare] = useState("");
  const [ventoMedioExt, setVentoMedioExt] = useState("");
  const [ventoRajadaExt, setVentoRajadaExt] = useState("");
  const [canalHsExt, setCanalHsExt] = useState("");
  const [canalTpExt, setCanalTpExt] = useState("");
  const [ventoMedioInt, setVentoMedioInt] = useState("");
  const [ventoRajadaInt, setVentoRajadaInt] = useState("");
  const [p1pHsInt, setP1pHsInt] = useState("");
  const [p1pTpInt, setP1pTpInt] = useState("");

  // NPCP e Persistência sempre OK
  const umaPorVezOk = true, sogOk = true, proibicoesOk = true, ukcOk = true, autorizacaoOk = true;
  const persistenciaOk = true;

  // Limites on‑berth automáticos
  const k = keyPierSide(pier, side);
  const preset = PRESETS_ON_BERTH[category]?.[k]?.[arranjo];
  const onP1Lim = preset?.P1 ?? { tp: 12, hs: 1.2 };
  const onP1PLim = preset?.P1P ?? { tp: 12, hs: 0.2 };

  // ---------- Motor de decisão ----------
  const decision = useMemo(() => {
    // Coerções numéricas seguras (inputs vazios ⇒ 0)
    const nLoa = parseFloat(loa) || 0;
    const nBoa = parseFloat(boa) || 0;
    const nCalado = parseFloat(calado) || 0;
    const nMare = parseFloat(mare) || 0;
    const nVentoMedioExt = parseFloat(ventoMedioExt) || 0;
    const nVentoRajadaExt = parseFloat(ventoRajadaExt) || 0;
    const nCanalHsExt = parseFloat(canalHsExt) || 0;
    const nCanalTpExt = parseFloat(canalTpExt) || 0;
    const nVentoMedioInt = parseFloat(ventoMedioInt) || 0;
    const nVentoRajadaInt = parseFloat(ventoRajadaInt) || 0;
    const nHsInt = parseFloat(p1pHsInt) || 0;
    const nTpInt = parseFloat(p1pTpInt) || 0;

    // NAV — externo
    const navReasons = [];
    const navFails = [];
    let navOK = true;

    // Restrições de categoria/berço
    if (category === "A" && pier === "P3" && side === "mar") {
      navOK = false; const msg = "Cat. A não autorizado em P3‑mar"; navReasons.push(msg); navFails.push(msg);
    }
    if (category === "TANQUE") {
      const valid = (pier === "P1" && side === "mar") || (pier === "P2" && side === "praia");
      if (!valid) { navOK = false; const msg = "Tanque somente em P1‑mar ou P2‑praia"; navReasons.push(msg); navFails.push(msg); }
    }

    // Hs×Tp externo (mar aberto)
    const canalRule = canalRuleFor(category, pier, side);
    if (!canalRule) {
      if (category === "TANQUE") { navOK = false; const msg = "Tanque fora dos berços válidos"; navReasons.push(msg); navFails.push(msg); }
    } else if (!(nCanalHsExt <= canalRule.hs && nCanalTpExt <= canalRule.tp)) {
      navOK = false; const msg = `Externo Hs×Tp excedido (limite ${canalRule.hs} m & ${canalRule.tp} s)`; navReasons.push(msg); navFails.push(msg);
    }

    // CMR/UKC por maré — porta de entrada
    const cmrCanal = canalAcesso === 'sul' ? interpCMR(CMR_TABLE.canalSul, nMare) : interpCMR(CMR_TABLE.canalNorte, nMare);
    const cmrBacia = interpCMR(CMR_TABLE.bacia, nMare);
    const cmrPier = interpCMR(CMR_TABLE.piersNorte, nMare);
    const cmrMin = Math.min(cmrCanal, cmrBacia, cmrPier);
    if (nCalado > cmrMin) {
      navOK = false; const msg = `CMR insuficiente: calado ${nCalado.toFixed(2)} m > CMR ${cmrMin.toFixed(2)} m (canal: ${cmrCanal} · bacia: ${cmrBacia} · píer: ${cmrPier})`;
      navReasons.push(msg); navFails.push(msg);
    }

    // PERMANÊNCIA — interno
    const perReasons = [];
    const perFails = [];
    let perOK = true;

    // Vento (pior caso) e rajada teto
    const ventoMedioWorst = Math.max(nVentoMedioInt, nVentoMedioExt);
    const ventoRajadaWorst = Math.max(nVentoRajadaInt, nVentoRajadaExt);
    const vmLim = ventoMedioLimite(category, pier, side, vizinhoOcupado);

    if (vmLim == null) { perOK = false; const msg = "Berço não aplicável para a categoria"; perReasons.push(msg); perFails.push(msg); }
    else if (ventoMedioWorst > vmLim) { perOK = false; const msg = `Vento médio (pior caso ${ventoMedioWorst} kn) > limite (${vmLim} kn)`; perReasons.push(msg); perFails.push(msg); }
    if (ventoRajadaWorst > RAJADA_TETO) { perOK = false; const msg = `Rajada (pior caso ${ventoRajadaWorst} kn) > teto (${RAJADA_TETO} kn)`; perReasons.push(msg); perFails.push(msg); }

    // Costados
    if (vizinhoOcupado && !distCostadosOK) { perOK = false; const msg = "Distância entre costados < 10 m com vizinho ocupado"; perReasons.push(msg); perFails.push(msg); }

    // On‑berth Hs×Tp — único Hs/Tp interno vs limite mais restritivo entre P1 e P1P
    const limMerged = minPairCorrect(onP1Lim, onP1PLim);
    const hsOk = (nHsInt <= limMerged.hs);
    const tpOk = (nTpInt <= limMerged.tp);
    if (!(hsOk && tpOk)) { perOK = false; const msg = `On‑berth interno Hs×Tp excedido (limite ${limMerged.hs} m & ${limMerged.tp} s)`; perReasons.push(msg); perFails.push(msg); }

    // P3/Poita — notas operacionais
    if (pier === "P3" && side === "praia") {
      perReasons.push("P3‑praia com AHTS 18k: proibido conectar Poita (somente no píer)");
      perReasons.push("P3‑praia: se LOA ≤ 82,4 m e houver manobra com P3‑mar, NÃO reconectar Poita após atracação do outro rebocador");
    }

    // Persistência temporal
    if (!persistenciaOk) { perOK = false; const msg = "Persistência temporal insuficiente para cobrir a operação"; perReasons.push(msg); perFails.push(msg); }

    // Consolidação
    let status = "Go";
    if (!navOK || !perOK) status = "No-Go";
    else {
      const near = [];
      if (vmLim != null && Math.abs(vmLim - ventoMedioWorst) <= 1) near.push("Vento médio próximo ao limite");
      if (Math.abs(RAJADA_TETO - ventoRajadaWorst) <= 1) near.push("Rajada próxima do teto");
      if (canalRule && (Math.abs(canalRule.hs - nCanalHsExt) <= 0.1 || Math.abs(canalRule.tp - nCanalTpExt) <= 0.5)) near.push("Externo Hs×Tp próximo do limite");
      if (Math.abs(limMerged.hs - nHsInt) <= 0.1 || Math.abs(limMerged.tp - nTpInt) <= 0.5) near.push("On‑berth interno Hs×Tp próximo do limite");
      if (Math.abs(cmrMin - nCalado) <= 0.1) near.push("CMR próximo do calado");
      if (near.length > 0) status = "Go com restrição";
      perReasons.push("Mitigações padrão (se Go‑restrito): reforço de amarração, tugs stand‑by, vigilância de rajadas/onda, pausa de convés.");
    }

    return {
      status,
      navegacao: { ok: navOK, reasons: navReasons, fails: navFails, dados: { externo: { hs: nCanalHsExt, tp: nCanalTpExt }, cmr: { canal: cmrCanal, bacia: cmrBacia, pier: cmrPier, minimo: cmrMin, mare: nMare } } },
      permanencia: { ok: perOK, reasons: perReasons, fails: perFails, dados: { interno: { P1P: { hs: nHsInt, tp: nTpInt } }, vento: { interno: { medio: nVentoMedioInt, rajada: nVentoRajadaInt }, externo: { medio: nVentoMedioExt, rajada: nVentoRajadaExt } } } }
    };
  }, [category,pier,side,arranjo,vizinhoOcupado,distCostadosOK,
      ventoMedioExt,ventoRajadaExt,canalHsExt,canalTpExt,
      ventoMedioInt,ventoRajadaInt,p1pHsInt,p1pTpInt,
      isAHTS18k,loa,calado,canalAcesso,mare]);

  // ---------- UI ----------
  return (
    <div className="min-h-screen bg-slate-50">
      {/* BARRA SUPERIOR — Decisão Geral na margem superior */}
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg md:text-2xl font-bold text-slate-900">SVNP‑Imbetiba</h1>
            <span className="hidden md:inline-block text-xs text-slate-500">Decisor • Navegação × Permanência</span>
          </div>
          <div>
            <Pill size="lg" tone={
              decision.status === 'Go' ? 'ok' :
              decision.status === 'Go com restrição' ? 'warn' : 'bad'
            }>{decision.status}</Pill>
          </div>
        </div>
      </div>

      {/* GRID PRINCIPAL */}
      <div className="mx-auto max-w-7xl px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* PRIMEIRA LINHA: Meteo & Hidro (esq) + Navio/Berço/Canal/Maré (dir) */}
        <div className="lg:col-span-12 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Meteo & Hidro */}
          <div className="lg:col-span-6">
            <Card title="Meteo & Hidro (único)" desc="Externo e Interno lado a lado; Canal/Maré estão no card ao lado.">
              <div className="flex flex-col gap-6 w-full">
                <div className="flex flex-wrap gap-6 w-full">
                  {/* Externo */}
                  <div className="flex-1 min-w-[460px] border rounded-xl p-4">
                    <h3 className="font-medium text-slate-800 mb-3">Externo</h3>
                    <div className="flex flex-wrap gap-4">
                      <div className="flex-1 min-w-[150px]"><Label>Hs externo</Label><NumberInput value={canalHsExt} onChange={setCanalHsExt} step={0.01} suffix="m" placeholder="ex.: 1.2" /></div>
                      <div className="flex-1 min-w-[150px]"><Label>Tp externo</Label><NumberInput value={canalTpExt} onChange={setCanalTpExt} step={0.1} suffix="s" placeholder="ex.: 10" /></div>
                      <div className="flex-1 min-w-[150px]"><Label>Vento médio</Label><NumberInput value={ventoMedioExt} onChange={setVentoMedioExt} suffix="kn" placeholder="ex.: 12" /></div>
                      <div className="flex-1 min-w-[150px]"><Label>Rajada</Label><NumberInput value={ventoRajadaExt} onChange={setVentoRajadaExt} suffix="kn" placeholder="ex.: 18" /></div>
                    </div>
                  </div>
                  {/* Interno */}
                  <div className="flex-1 min-w-[460px] border rounded-xl p-4">
                    <h3 className="font-medium text-slate-800 mb-3">Interno — Porto</h3>
                    <div className="flex flex-wrap gap-4">
                      <div className="flex-1 min-w-[150px]"><Label>Hs interno</Label><NumberInput value={p1pHsInt} onChange={setP1pHsInt} step={0.01} suffix="m" placeholder="ex.: 0.12" /></div>
                      <div className="flex-1 min-w-[150px]"><Label>Tp interno</Label><NumberInput value={p1pTpInt} onChange={setP1pTpInt} step={0.1} suffix="s" placeholder="ex.: 10.5" /></div>
                      <div className="flex-1 min-w-[150px]"><Label>Vento médio interno</Label><NumberInput value={ventoMedioInt} onChange={setVentoMedioInt} suffix="kn" placeholder="ex.: 12" /></div>
                      <div className="flex-1 min-w-[150px]"><Label>Rajada interna</Label><NumberInput value={ventoRajadaInt} onChange={setVentoRajadaInt} suffix="kn" placeholder="ex.: 18" /></div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Navio, Berço & Canal/Maré */}
          <div className="lg:col-span-6">
            <Card title="Navio, Berço & Canal/Maré" desc="Fluxo: Navio → Berço → Acesso (CMR)">
              <div className="space-y-6">
                {/* Navio */}
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-2 w-2 rounded-full bg-slate-400"></div>
                    <h3 className="text-sm font-semibold text-slate-800">Navio</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <div className="md:col-span-4">
                      <Label>Categoria</Label>
                      <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={category} onChange={e=>setCategory(e.target.value)}>
                        {CATEGORIES.map(c=> <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <Label hint="Comprimento total">LOA</Label>
                      <NumberInput value={loa} onChange={setLoa} suffix="m" placeholder="ex.: 100" />
                    </div>
                    <div className="md:col-span-2">
                      <Label hint="Boca (largura)">BOA</Label>
                      <NumberInput value={boa} onChange={setBoa} suffix="m" placeholder="ex.: 20" />
                    </div>
                    <div className="md:col-span-2">
                      <Label>Calado</Label>
                      <NumberInput value={calado} onChange={setCalado} suffix="m" placeholder="ex.: 7.5" />
                    </div>
                    <div className="md:col-span-2 flex items-end">
                      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={isAHTS18k} onChange={e=>setIsAHTS18k(e.target.checked)} />AHTS 18k</label>
                    </div>
                  </div>
                </div>

                {/* Berço */}
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-2 w-2 rounded-full bg-blue-400"></div>
                    <h3 className="text-sm font-semibold text-slate-800">Berço</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <div className="md:col-span-3">
                      <Label>Píer</Label>
                      <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={pier} onChange={e=>setPier(e.target.value)}>
                        {PIERS.map(p=> <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-3">
                      <Label>Lado</Label>
                      <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={side} onChange={e=>setSide(e.target.value)}>
                        {SIDES.map(s=> <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-4">
                      <Label>Arranjo de amarração</Label>
                      <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={arranjo} onChange={e=>setArranjo(parseInt(e.target.value))}>
                        {[1,2,3,4].map(n=> <option key={n} value={n}>Arranjo {n}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-2 flex items-end">
                      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={vizinhoOcupado} onChange={e=>setVizinhoOcupado(e.target.checked)} />Vizinho ocupado (≥10 m)</label>
                    </div>
                  </div>
                  {vizinhoOcupado && (
                    <div className="mt-2">
                      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={distCostadosOK} onChange={e=>setDistCostadosOK(e.target.checked)} />Confirmo distância ≥ 10 m</label>
                    </div>
                  )}
                </div>

                {/* Acesso (Canal/Maré/CMR) */}
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-2 w-2 rounded-full bg-emerald-400"></div>
                    <h3 className="text-sm font-semibold text-slate-800">Acesso (Canal/Maré)</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    <div className="md:col-span-4">
                      <Label>Canal de acesso</Label>
                      <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={canalAcesso} onChange={e=>setCanalAcesso(e.target.value)}>
                        {CANAIS.map(c=> <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-3">
                      <Label hint="Nível instantâneo (referência local)">Maré</Label>
                      <NumberInput value={mare} onChange={setMare} step={0.01} suffix="m" placeholder="ex.: 0.6" />
                    </div>
                    <div className="md:col-span-5">
                      <div className="bg-white border rounded-xl p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-[12px] font-semibold text-slate-700">CMR calculado</div>
                          <Pill size="md" tone="info">mín {canalAcesso==='sul'? interpCMR(CMR_TABLE.canalSul, parseFloat(mare)||0):interpCMR(CMR_TABLE.canalNorte, parseFloat(mare)||0)} / {interpCMR(CMR_TABLE.bacia, parseFloat(mare)||0)} / {interpCMR(CMR_TABLE.piersNorte, parseFloat(mare)||0)} m</Pill>
                        </div>
                        <div className="text-[12px] text-slate-600 mt-1">Canal · Bacia · Píer — menor valor como gate</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* SEGUNDA LINHA: Navegação & Permanência */}
        <div className="lg:col-span-12">
          <Card title="Navegação & Permanência" desc="Detalhamento por fase e itens NÃO atendidos.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-slate-800">Navegação (Entrada)</h3>
                  <Pill size="md" tone={decision.navegacao.ok ? 'ok' : 'bad'}>{decision.navegacao.ok ? 'OK' : 'NÃO OK'}</Pill>
                </div>
                {decision.navegacao.fails.length > 0 && (
                  <div className="mb-2">
                    <div className="text-xs font-semibold text-rose-700">Itens NÃO atendidos</div>
                    <ul className="list-disc pl-5 text-sm text-rose-700">{decision.navegacao.fails.map((r, i) => (<li key={i}>{r}</li>))}</ul>
                  </div>
                )}
                <div className="text-xs text-slate-600 mt-2 space-y-1">
                  <div><span className="font-semibold">Externo:</span> Hs={decision.navegacao.dados.externo.hs} m · Tp={decision.navegacao.dados.externo.tp} s</div>
                  <div><span className="font-semibold">CMR:</span> mín={decision.navegacao.dados.cmr.minimo} m (canal {decision.navegacao.dados.cmr.canal} · bacia {decision.navegacao.dados.cmr.bacia} · píer {decision.navegacao.dados.cmr.pier}) · maré={decision.navegacao.dados.cmr.mare} m</div>
                  <div>NPCP: 1 navio/vez · SOG≤5 · sem DP/testes/piloto/fundeio · UKC/CMR OK · AP/DELTA OK</div>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-slate-800">Permanência (On‑Berth)</h3>
                  <Pill size="md" tone={decision.permanencia.ok ? 'ok' : 'bad'}>{decision.permanencia.ok ? 'OK' : 'NÃO OK'}</Pill>
                </div>
                {decision.permanencia.fails.length > 0 && (
                  <div className="mb-2">
                    <div className="text-xs font-semibold text-rose-700">Itens NÃO atendidos</div>
                    <ul className="list-disc pl-5 text-sm text-rose-700">{decision.permanencia.fails.map((r, i) => (<li key={i}>{r}</li>))}</ul>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 text-xs text-slate-600 mt-2">
                  <div>
                    <div className="font-semibold">Ondas internas</div>
                    <div>Hs={decision.permanencia.dados.interno.P1P.hs} m · Tp={decision.permanencia.dados.interno.P1P.tp} s</div>
                  </div>
                  <div>
                    <div className="font-semibold">Vento</div>
                    <div>Interno: médio={decision.permanencia.dados.vento.interno.medio} kn · rajada={decision.permanencia.dados.vento.interno.rajada} kn</div>
                    <div>Externo: médio={decision.permanencia.dados.vento.externo.medio} kn · rajada={decision.permanencia.dados.vento.externo.rajada} kn</div>
                    <div className="mt-1">Regra: usa‑se o <em>pior caso</em> para vento/rajada. Teto de rajada = {RAJADA_TETO} kn.</div>
                  </div>
                </div>
                <div className="text-[11px] text-slate-500 mt-2">Notas operacionais: P3/Poita, LOA ≤ 82,4 m e AHTS 18k são avaliados automaticamente.</div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Barra fixa inferior (resumo rápido) */}
      <div className="sticky bottom-0 inset-x-0 border-t border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between gap-4">
          <div className="text-xs text-slate-500">v0.92 — Base limpa para consulta + funcionamento validado</div>
          <div>
            <Pill size="lg" tone={
              decision.status === 'Go' ? 'ok' :
              decision.status === 'Go com restrição' ? 'warn' : 'bad'
            }>{decision.status}</Pill>
          </div>
        </div>
      </div>
    </div>
  );
}
