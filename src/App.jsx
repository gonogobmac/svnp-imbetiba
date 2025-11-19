import React, { useState, useMemo, useEffect } from "react";

/**
 * SVNP-Imbetiba — V3.3 (GO/NO-GO + Base + GitHub Manual Sync)
 * -------------------------------------------------------------------
 * ✔ Foco principal: GO / NO-GO (metoceanografia + dados da embarcação)
 * ✔ Aba "Base de Embarcações" com listagem dos registros
 * ✔ Cadastro: Nome, Categoria, LOA, Boca, Calado
 * ✔ Autocomplete de embarcações cadastradas
 * ✔ Nota Técnica: renderizada em tela, com opção de imprimir
 * ✔ NOVO: Botões na aba de Base para
 *      • Importar lista do GitHub (GET /api/vessels)
 *      • Salvar lista no GitHub (PUT /api/vessels)
 */

// ------------------- Regras -------------------
const WIND_GUST_LIMIT = 27;
const MIN_BERTH_DEPTH = 10;
const SECTORS = ["Interno", "Externo"];

const LIMITS = {
  Interno: {
    A: { hs: 2.0, tp: 10 },
    B: { hs: 1.8, tp: 10 },
    C: { hs: 1.5, tp: 9 },
    Tanque: { hs: 1.2, tp: 8 },
  },
  Externo: {
    A: { hs: 2.5, tp: 12 },
    B: { hs: 2.2, tp: 11 },
    C: { hs: 2.0, tp: 10 },
    Tanque: { hs: 1.5, tp: 9 },
  },
};

function goNoGo(vessel, meto, depth) {
  if (!vessel) return null;
  const limits = LIMITS[meto.sector][vessel.category];

  if (meto.gust > WIND_GUST_LIMIT) {
    return {
      ok: false,
      reason: `Rajada ${meto.gust} kn > ${WIND_GUST_LIMIT} kn`,
    };
  }

  if (meto.hs > limits.hs) {
    return {
      ok: false,
      reason: `Hs ${meto.hs} m > ${limits.hs} m (${meto.sector}/${vessel.category})`,
    };
  }

  if (meto.tp > limits.tp) {
    return {
      ok: false,
      reason: `Tp ${meto.tp} s > ${limits.tp} s (${meto.sector}/${vessel.category})`,
    };
  }

  if (depth < MIN_BERTH_DEPTH) {
    return {
      ok: false,
      reason: `Costado ${depth} m < ${MIN_BERTH_DEPTH} m`,
    };
  }

  return {
    ok: true,
    reason: "Condições compatíveis com os limites operacionais",
  };
}

// ------------------- Componente -------------------
export default function Component() {
  // Metoceanografia
  const [meto, setMeto] = useState({
    sector: "Interno",
    wind: 15,
    gust: 20,
    hs: 1.2,
    tp: 8,
    tide: "Enchente",
  });

  const [depth, setDepth] = useState(10.5);

  // Embarcação em avaliação
  const [vessel, setVessel] = useState({
    name: "",
    category: "A",
    loa: "",
    draft: "",
    beam: "",
  });

  // Base de embarcações cadastradas
  const [vesselDB, setVesselDB] = useState([]); // {id,name,category,loa,draft,beam}

  // Controle GitHub
  const [githubSha, setGithubSha] = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | loading | saving | ok | error

  // Aba ativa: "go" ou "cadastro"
  const [activeTab, setActiveTab] = useState("go");

  // Mostrar/ocultar nota técnica em tela
  const [showNote, setShowNote] = useState(false);

  // Carrega base do localStorage (cache local inicial)
  useEffect(() => {
    try {
      const raw = localStorage.getItem("svnp_vessels_v3");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setVesselDB(parsed);
        }
      }
    } catch {
      // silencioso
    }
  }, []);

  // Salva base no localStorage sempre que mudar (independente do GitHub)
  useEffect(() => {
    try {
      localStorage.setItem("svnp_vessels_v3", JSON.stringify(vesselDB));
    } catch {
      // silencioso
    }
  }, [vesselDB]);

  function genId() {
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    );
  }

  function upsertVessel(entry) {
    setVesselDB((prev) => {
      const idx = prev.findIndex(
        (v) => v.name.toLowerCase() === entry.name.toLowerCase()
      );
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...entry };
        return copy;
      }
      return [...prev, { ...entry, id: genId() }];
    });
  }

  function removeVessel(id) {
    setVesselDB((prev) => prev.filter((v) => v.id !== id));
  }

  // Sugestões de nome conforme digita
  const nameSuggestions = useMemo(() => {
    const term = vessel.name.trim().toLowerCase();
    if (term.length < 1) return [];
    return vesselDB.filter((v) => v.name.toLowerCase().includes(term));
  }, [vessel.name, vesselDB]);

  const verdict = useMemo(
    () => goNoGo(vessel.name ? vessel : null, meto, depth),
    [vessel, meto, depth]
  );

  const isReady = Boolean(vessel.name && vessel.category);

  // Sempre que embarcação ou meto mudarem, escondemos a nota antiga
  useEffect(() => {
    setShowNote(false);
  }, [vessel, meto, depth]);

  // -------- Integração GitHub (manual, via botões) --------

  async function importFromGitHub() {
    try {
      setSyncStatus("loading");
      const res = await fetch("data/vessels");
      if (!res.ok) throw new Error("Falha ao ler data/vessels");
      const json = await res.json();
      if (Array.isArray(json.data)) {
        setVesselDB(json.data);
        setGithubSha(json.sha || null);
        setSyncStatus("ok");
        try {
          localStorage.setItem("svnp_vessels_v3", JSON.stringify(json.data));
        } catch {}
      } else {
        setSyncStatus("error");
      }
    } catch (err) {
      console.error("Erro ao importar do GitHub:", err);
      setSyncStatus("error");
    }
  }

  async function saveToGitHub() {
    try {
      setSyncStatus("saving");
      const res = await fetch("/data/vessels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: vesselDB, sha: githubSha }),
      });

      if (!res.ok) throw new Error("Falha ao salvar /data/vessels");

      const json = await res.json();
      if (json.sha) setGithubSha(json.sha);
      setSyncStatus("ok");
    } catch (err) {
      console.error("Erro ao salvar no GitHub:", err);
      setSyncStatus("error");
    }
  }

  const syncLabelMap = {
    idle: "Offline (local)",
    loading: "Carregando do GitHub...",
    saving: "Salvando no GitHub...",
    ok: "Sincronizado com GitHub",
    error: "Erro na sincronização",
  };

  const syncLabel = syncLabelMap[syncStatus] || "";

  return (
    <div className="min-h-screen bg-white p-6 max-w-5xl mx-auto space-y-4">
      <header className="border-b pb-3 mb-2 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">
            Sistema de Validação de Navegação Portuária
          </p>
          <h1 className="text-base font-semibold mt-1">
            SVNP-Imbetiba — V3.3 (GO/NO-GO + Base de Embarcações)
          </h1>
        </div>
        <div className="text-right text-[11px] text-gray-500">
          <p>DELTA II · LOEP / LPM / OPRT-M</p>
        </div>
      </header>

      {/* Abas principais */}
      <div className="flex items-center gap-2 border-b pb-2 mb-2 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab("go")}
          className={
            "rounded-full px-3 py-1 " +
            (activeTab === "go"
              ? "bg-black text-white"
              : "bg-gray-100 text-gray-700")
          }
        >
          GO / NO-GO
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("cadastro")}
          className={
            "rounded-full px-3 py-1 " +
            (activeTab === "cadastro"
              ? "bg-black text-white"
              : "bg-gray-100 text-gray-700")
          }
        >
          Base de Embarcações
        </button>
      </div>

      {activeTab === "go" ? (
        <>
          {/* Grid principal: METO x Embarcação */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* METO */}
            <section className="border rounded-xl p-4 space-y-3">
              <h2 className="text-sm font-semibold uppercase text-gray-600">
                Condições Meteoceanográficas
              </h2>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="text-xs text-gray-600">Setor</label>
                  <select
                    value={meto.sector}
                    onChange={(e) => setMeto({ ...meto, sector: e.target.value })}
                    className="mt-1 w-full border rounded-lg p-2 text-sm"
                  >
                    {SECTORS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-gray-600">Costado (m)</label>
                  <input
                    type="number"
                    value={depth}
                    onChange={(e) => setDepth(Number(e.target.value) || 0)}
                    className="mt-1 w-full border rounded-lg p-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Vento (kn)</label>
                  <input
                    type="number"
                    value={meto.wind}
                    onChange={(e) =>
                      setMeto({ ...meto, wind: Number(e.target.value) || 0 })
                    }
                    className="mt-1 w-full border rounded-lg p-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Rajada (kn)</label>
                  <input
                    type="number"
                    value={meto.gust}
                    onChange={(e) =>
                      setMeto({ ...meto, gust: Number(e.target.value) || 0 })
                    }
                    className="mt-1 w-full border rounded-lg p-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Hs (m)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={meto.hs}
                    onChange={(e) =>
                      setMeto({ ...meto, hs: Number(e.target.value) || 0 })
                    }
                    className="mt-1 w-full border rounded-lg p-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Tp (s)</label>
                  <input
                    type="number"
                    value={meto.tp}
                    onChange={(e) =>
                      setMeto({ ...meto, tp: Number(e.target.value) || 0 })
                    }
                    className="mt-1 w-full border rounded-lg p-2 text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600">Maré</label>
                  <select
                    value={meto.tide}
                    onChange={(e) => setMeto({ ...meto, tide: e.target.value })}
                    className="mt-1 w-full border rounded-lg p-2 text-sm"
                  >
                    <option>Enchente</option>
                    <option>Vazante</option>
                    <option>Estofa</option>
                  </select>
                </div>
              </div>

              <p className="mt-2 text-[11px] text-gray-500">
                Limites: rajada ≤ {WIND_GUST_LIMIT} kn · costado ≥ {MIN_BERTH_DEPTH} m ·
                matriz Hs×Tp por setor/categoria.
              </p>
            </section>

            {/* EMBARCAÇÃO */}
            <section className="border rounded-xl p-4 space-y-3">
              <h2 className="text-sm font-semibold uppercase text-gray-600">
                Embarcação
              </h2>

              <div className="space-y-3 text-sm">
                <div className="relative">
                  <label className="text-xs text-gray-600">Nome</label>
                  <input
                    value={vessel.name}
                    onChange={(e) =>
                      setVessel((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="Digite o nome da embarcação"
                    className="mt-1 w-full border rounded-lg p-2 text-sm"
                  />

                  {/* Lista suspensa de sugestões */}
                  {vessel.name.trim() !== "" && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-lg text-xs max-h-40 overflow-auto">
                      {nameSuggestions.length > 0 ? (
                        nameSuggestions.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() =>
                              setVessel({
                                name: v.name,
                                category: v.category || "A",
                                loa: v.loa != null ? String(v.loa) : "",
                                draft: v.draft != null ? String(v.draft) : "",
                                beam: v.beam != null ? String(v.beam) : "",
                              })
                            }
                            className="block w-full px-3 py-1 text-left hover:bg-gray-100"
                          >
                            {v.name}{" "}
                            <span className="text-[10px] text-gray-500">
                              (cat. {v.category})
                            </span>
                          </button>
                        ))
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            upsertVessel({
                              name: vessel.name.trim(),
                              category: vessel.category,
                              loa: vessel.loa ? Number(vessel.loa) : undefined,
                              draft: vessel.draft
                                ? Number(vessel.draft)
                                : undefined,
                              beam: vessel.beam
                                ? Number(vessel.beam)
                                : undefined,
                            })
                          }
                          className="block w-full px-3 py-2 text-left text-gray-700 hover:bg-gray-100"
                        >
                          ➕ Cadastrar "{vessel.name.trim()}" na base de embarcações
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-gray-600">Categoria</label>
                    <select
                      value={vessel.category}
                      onChange={(e) =>
                        setVessel((prev) => ({ ...prev, category: e.target.value }))
                      }
                      className="mt-1 w-full border rounded-lg p-2 text-sm"
                    >
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                      <option value="Tanque">Tanque</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-gray-600">LOA (m)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={vessel.loa}
                      onChange={(e) =>
                        setVessel((prev) => ({ ...prev, loa: e.target.value }))
                      }
                      className="mt-1 w-full border rounded-lg p-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-600">Calado (m)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={vessel.draft}
                      onChange={(e) =>
                        setVessel((prev) => ({ ...prev, draft: e.target.value }))
                      }
                      className="mt-1 w-full border rounded-lg p-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-gray-600">Boca (m)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={vessel.beam}
                      onChange={(e) =>
                        setVessel((prev) => ({ ...prev, beam: e.target.value }))
                      }
                      className="mt-1 w-full border rounded-lg p-2 text-sm"
                    />
                  </div>
                </div>

                <div className="pt-1 text-[11px] text-gray-500">
                  <p>
                    • Comece a digitar o nome para buscar na base. Se não existir, use a opção de
                    cadastro exibida abaixo do campo.
                  </p>
                </div>
              </div>
            </section>
          </div>

          {/* Bloco de resultado GO/NO-GO */}
          <section className="border rounded-xl p-4 space-y-3 bg-gray-50">
            <h2 className="text-sm font-semibold uppercase text-gray-600">
              Resultado — GO / NO-GO
            </h2>

            {!isReady ? (
              <p className="text-sm text-gray-500">
                Informe pelo menos o <strong>nome</strong> e a <strong>categoria</strong> da
                embarcação para calcular o resultado.
              </p>
            ) : verdict ? (
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold " +
                      (verdict.ok
                        ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                        : "bg-red-100 text-red-700 border border-red-200")
                    }
                  >
                    {verdict.ok ? "GO" : "NO-GO"}
                  </span>
                  <span className="text-xs text-gray-600">{verdict.reason}</span>
                </div>

                <p className="text-xs text-gray-600">
                  Embarcação <strong>{vessel.name}</strong> (cat. {vessel.category}) — Setor
                  <strong> {meto.sector}</strong>, vento
                  <strong> {meto.wind}/{meto.gust} kn</strong>, Hs/Tp
                  <strong> {meto.hs} m / {meto.tp} s</strong>, costado
                  <strong> {depth} m</strong>.
                </p>

                {!verdict.ok && (
                  <button
                    type="button"
                    onClick={() => setShowNote(true)}
                    className="mt-2 inline-flex items-center rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700"
                  >
                    📄 Exibir Nota Técnica de NO-GO
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                Ajuste os parâmetros meteoceanográficos e os dados da embarcação para visualizar o
                resultado.
              </p>
            )}
          </section>

          {/* Nota técnica em tela */}
          {showNote && verdict && !verdict.ok && (
            <section className="mt-4 border rounded-xl p-4 bg-white text-sm">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold uppercase text-gray-700">
                  Nota Técnica — Justificativa de NO-GO
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        window.print();
                      }
                    }}
                    className="rounded-md border px-3 py-1 text-xs"
                  >
                    Imprimir
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNote(false)}
                    className="rounded-md border px-3 py-1 text-xs"
                  >
                    Fechar
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-500">
                    Gerado pelo SVNP-Imbetiba — {new Date().toLocaleString()}
                  </p>
                </div>

                <div>
                  <h3 className="text-xs font-semibold mb-1">1. Identificação da operação</h3>
                  <table className="min-w-full border text-[11px]">
                    <tbody>
                      <tr>
                        <td className="border px-2 py-1 w-40">Embarcação</td>
                        <td className="border px-2 py-1">{vessel.name}</td>
                      </tr>
                      <tr>
                        <td className="border px-2 py-1">Categoria</td>
                        <td className="border px-2 py-1">{vessel.category}</td>
                      </tr>
                      <tr>
                        <td className="border px-2 py-1">LOA</td>
                        <td className="border px-2 py-1">{vessel.loa || "—"} m</td>
                      </tr>
                      <tr>
                        <td className="border px-2 py-1">Calado</td>
                        <td className="border px-2 py-1">{vessel.draft || "—"} m</td>
                      </tr>
                      <tr>
                        <td className="border px-2 py-1">Boca</td>
                        <td className="border px-2 py-1">{vessel.beam || "—"} m</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div>
                  <h3 className="text-xs font-semibold mb-1">2. Condições Ambientais</h3>
                  <table className="min-w-full border text-[11px]">
                    <tbody>
                      <tr>
                        <td className="border px-2 py-1 w-40">Setor</td>
                        <td className="border px-2 py-1">{meto.sector}</td>
                      </tr>
                      <tr>
                        <td className="border px-2 py-1">Vento</td>
                        <td className="border px-2 py-1">
                          {meto.wind} kn (rajada {meto.gust} kn)
                        </td>
                      </tr>
                      <tr>
                        <td className="border px-2 py-1">Hs / Tp</td>
                        <td className="border px-2 py-1">
                          {meto.hs} m / {meto.tp} s
                        </td>
                      </tr>
                      <tr>
                        <td className="border px-2 py-1">Maré</td>
                        <td className="border px-2 py-1">{meto.tide}</td>
                      </tr>
                      <tr>
                        <td className="border px-2 py-1">Profundidade (costado)</td>
                        <td className="border px-2 py-1">{depth} m</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div>
                  <h3 className="text-xs font-semibold mb-1">3. Decisão</h3>
                  <p className="text-[11px]">
                    <strong>{verdict.ok ? "GO" : "NO-GO"}</strong> — {verdict.reason}
                  </p>
                </div>

                <div>
                  <h3 className="text-xs font-semibold mb-1">4. Assinatura</h3>
                  <p className="text-[11px] leading-relaxed">
                    <strong>OFICIAIS PORTUÁRIOS</strong>
                    <br />
                    Oficiais da Marinha Mercante
                    <br />
                    <strong>DELTA II</strong>
                    <br />
                    LOEP / LPM / OPRT-M
                  </p>
                </div>
              </div>
            </section>
          )}
        </>
      ) : (
        // ABA DE CADASTRO / BASE DE EMBARCAÇÕES
        <section className="border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase text-gray-600">
                Base de Embarcações Cadastradas
              </h2>
              <p className="text-[11px] text-gray-500">
                Lista de todas as embarcações registradas no sistema. Utilize esta aba para revisão e
                ajuste dos dados (Nome, Categoria, LOA, Boca, Calado).
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 text-[10px]">
              <span className="text-gray-500">{syncLabel}</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={importFromGitHub}
                  className="rounded-md border px-2 py-1 text-[10px]"
                >
                  Importar do GitHub
                </button>
                <button
                  type="button"
                  onClick={saveToGitHub}
                  className="rounded-md border px-2 py-1 text-[10px]"
                >
                  Salvar no GitHub
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-auto max-h-[60vh]">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left border-b bg-gray-50">
                  <th className="py-2 pr-3">Nome</th>
                  <th className="py-2 pr-3">Categoria</th>
                  <th className="py-2 pr-3">LOA (m)</th>
                  <th className="py-2 pr-3">Calado (m)</th>
                  <th className="py-2 pr-3">Boca (m)</th>
                  <th className="py-2 pr-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {vesselDB.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-4 text-center text-[11px] text-gray-500"
                    >
                      Nenhuma embarcação cadastrada até o momento.
                    </td>
                  </tr>
                ) : (
                  vesselDB.map((v) => (
                    <tr key={v.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 text-xs font-medium">{v.name}</td>
                      <td className="py-2 pr-3 text-xs">{v.category || "-"}</td>
                      <td className="py-2 pr-3 text-xs">{v.loa ?? "-"}</td>
                      <td className="py-2 pr-3 text-xs">{v.draft ?? "-"}</td>
                      <td className="py-2 pr-3 text-xs">{v.beam ?? "-"}</td>
                      <td className="py-2 pr-3 text-xs">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setVessel({
                                name: v.name,
                                category: v.category || "A",
                                loa: v.loa != null ? String(v.loa) : "",
                                draft: v.draft != null ? String(v.draft) : "",
                                beam: v.beam != null ? String(v.beam) : "",
                              })
                            }
                            className="rounded-md border px-2 py-1 text-[10px]"
                          >
                            Usar no GO/NO-GO
                          </button>
                          <button
                            type="button"
                            onClick={() => removeVessel(v.id)}
                            className="rounded-md border px-2 py-1 text-[10px] text-red-600"
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
