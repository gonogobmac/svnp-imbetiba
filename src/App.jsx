import React, { useState, useMemo, useEffect } from "react";

/**
 * SVNP-Imbetiba — V3.4
 * -------------------------------------------------------------------
 * ✔ Foco principal: GO / NO-GO (metoceanografia + dados da embarcação)
 * ✔ Aba "Base de Embarcações" com listagem dos registros
 * ✔ Cadastro somente na aba de Base (botão "Adicionar embarcação" + popup)
 * ✔ Tela principal: seleção de embarcações em até 6 posições (P1/P2/P3 · praia/mar)
 * ✔ Cada posição avaliada individualmente com base nas condições meteoceanográficas
 * ✔ Nota Técnica de NO-GO por embarcação/posição, renderizada em tela
 * ✔ Integração manual com GitHub (Importar / Salvar) na aba de Base
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

const PIER_SLOTS = [
  { id: "P1P", label: "Píer 1 — Lado Praia" },
  { id: "P1M", label: "Píer 1 — Lado Mar" },
  { id: "P2P", label: "Píer 2 — Lado Praia" },
  { id: "P2M", label: "Píer 2 — Lado Mar" },
  { id: "P3P", label: "Píer 3 — Lado Praia" },
  { id: "P3M", label: "Píer 3 — Lado Mar" },
];

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
  // Metoceanografia (comuns a todas as embarcações)
  const [meto, setMeto] = useState({
    sector: "Interno",
    wind: 15,
    gust: 20,
    hs: 1.2,
    tp: 8,
    tide: "Enchente",
  });

  const [depth, setDepth] = useState(10.5);

  // Base de embarcações cadastradas
  const [vesselDB, setVesselDB] = useState([]); // {id,name,category,loa,draft,beam}

  // Atribuições por píer (cada posição guarda o id da embarcação ou "")
  const [berthAssignments, setBerthAssignments] = useState(() => {
    const initial = {};
    PIER_SLOTS.forEach((slot) => {
      initial[slot.id] = "";
    });
    return initial;
  });

  // Texto de busca por píer (para digitar o nome e filtrar a base)
  const [berthSearch, setBerthSearch] = useState(() => {
    const initial = {};
    PIER_SLOTS.forEach((slot) => {
      initial[slot.id] = "";
    });
    return initial;
  });

  // Controle GitHub
  const [githubSha, setGithubSha] = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | loading | saving | ok | error

  // Aba ativa: "go" ou "cadastro"
  const [activeTab, setActiveTab] = useState("go");

  // Nota técnica em contexto (por embarcação/posição)
  const [noteContext, setNoteContext] = useState(null); // {slot, vessel, verdict}

  // Modal de "Adicionar embarcação" (na aba de Base)
  const [showAddModal, setShowAddModal] = useState(false);
  const [newVessel, setNewVessel] = useState({
    name: "",
    category: "A",
    loa: "",
    draft: "",
    beam: "",
  });

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

  // Se meto, profundidade ou atribuições mudarem, limpamos nota técnica atual
  useEffect(() => {
    setNoteContext(null);
  }, [berthAssignments, meto, depth]);

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

    // Remove a embarcação de qualquer posição em que esteja atribuída
    setBerthAssignments((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        if (next[key] === id) next[key] = "";
      });
      return next;
    });
  }

  // -------- Integração GitHub (manual, via botões na aba de Base) --------

  async function importFromGitHub() {
    try {
      setSyncStatus("loading");
      const res = await fetch("/api/vessels");
      if (!res.ok) throw new Error("Falha ao ler /api/vessels");
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
      const res = await fetch("/api/vessels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: vesselDB, sha: githubSha }),
      });

      if (!res.ok) throw new Error("Falha ao salvar /api/vessels");

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

  // -------- GO/NO-GO por posição de píer --------

  const slotVerdicts = useMemo(() => {
    return PIER_SLOTS.map((slot) => {
      const vesselId = berthAssignments[slot.id];
      const vessel = vesselDB.find((v) => v.id === vesselId) || null;
      const verdict = vessel ? goNoGo(vessel, meto, depth) : null;
      return { slot, vessel, verdict };
    });
  }, [berthAssignments, vesselDB, meto, depth]);

  const anySelected = slotVerdicts.some((sv) => sv.vessel);

  return (
    <div className="min-h-screen bg-white p-6 max-w-5xl mx-auto space-y-4">
      <header className="border-b pb-3 mb-2 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">
            Sistema de Validação de Navegação Portuária
          </p>
          <h1 className="text-base font-semibold mt-1">
            SVNP-Imbetiba — V3.4 (GO/NO-GO por Píer)
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
          {/* Grid principal: METO x Posições de Píer */}
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

            {/* Disposição por Píer */}
            <section className="border rounded-xl p-4 space-y-3">
              <h2 className="text-sm font-semibold uppercase text-gray-600">
                Posições de Atracação (P1 / P2 / P3 · Praia / Mar)
              </h2>

              <p className="text-[11px] text-gray-500 mb-1">
                Selecione, para cada posição, uma embarcação cadastrada na base para análise de
                GO/NO-GO frente às condições informadas.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {PIER_SLOTS.map((slot) => {
                  const term = (berthSearch[slot.id] || "").trim().toLowerCase();
                  const suggestions = term
                    ? vesselDB.filter((v) =>
                        v.name.toLowerCase().includes(term)
                      )
                    : vesselDB;

                  const selectedVessel = vesselDB.find(
                    (v) => v.id === berthAssignments[slot.id]
                  );

                  return (
                    <div key={slot.id} className="border rounded-lg p-2 relative">
                      <p className="text-xs font-semibold text-gray-700 mb-1">
                        {slot.label}
                      </p>
                      <input
                        value={berthSearch[slot.id] || ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          setBerthSearch((prev) => ({
                            ...prev,
                            [slot.id]: value,
                          }));
                          // não altera a atribuição até escolher uma sugestão
                        }}
                        placeholder="Digite o nome e selecione"
                        className="w-full border rounded-lg p-2 text-xs"
                      />
                      {selectedVessel && (
                        <p className="mt-1 text-[10px] text-gray-500">
                          Selecionado: <strong>{selectedVessel.name}</strong>{" "}
                          {selectedVessel.category
                            ? `(cat. ${selectedVessel.category})`
                            : ""}
                        </p>
                      )}

                      {/* Lista de sugestões */}
                      {term && suggestions.length > 0 && (
                        <div className="absolute z-20 mt-1 w-full rounded-md border bg-white shadow-lg text-[11px] max-h-40 overflow-auto">
                          {suggestions.map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => {
                                setBerthAssignments((prev) => ({
                                  ...prev,
                                  [slot.id]: v.id,
                                }));
                                setBerthSearch((prev) => ({
                                  ...prev,
                                  [slot.id]: v.name,
                                }));
                              }}
                              className="block w-full px-3 py-1 text-left hover:bg-gray-100"
                            >
                              {v.name}{" "}
                              <span className="text-[10px] text-gray-500">
                                {v.category ? `(cat. ${v.category})` : ""}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Botão limpar posição */}
                      {selectedVessel && (
                        <button
                          type="button"
                          onClick={() => {
                            setBerthAssignments((prev) => ({
                              ...prev,
                              [slot.id]: "",
                            }));
                            setBerthSearch((prev) => ({
                              ...prev,
                              [slot.id]: "",
                            }));
                          }}
                          className="mt-2 inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] text-gray-600"
                        >
                          Limpar posição
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Bloco de resultado GO/NO-GO por posição */}
          <section className="border rounded-xl p-4 space-y-3 bg-gray-50">
            <h2 className="text-sm font-semibold uppercase text-gray-600">
              Resultado — GO / NO-GO por Posição de Píer
            </h2>

            {!anySelected ? (
              <p className="text-sm text-gray-500">
                Selecione ao menos uma embarcação nas posições de píer ao lado para calcular o
                resultado de GO/NO-GO.
              </p>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left border-b bg-gray-100">
                      <th className="py-2 pr-3">Posição</th>
                      <th className="py-2 pr-3">Embarcação</th>
                      <th className="py-2 pr-3">Categoria</th>
                      <th className="py-2 pr-3">Resultado</th>
                      <th className="py-2 pr-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slotVerdicts.map(({ slot, vessel, verdict }) => {
                      if (!vessel) return null;
                      const ok = verdict && verdict.ok;
                      return (
                        <tr key={slot.id} className="border-b last:border-0">
                          <td className="py-2 pr-3 text-xs">{slot.label}</td>
                          <td className="py-2 pr-3 text-xs font-medium">
                            {vessel.name}
                          </td>
                          <td className="py-2 pr-3 text-xs">{vessel.category}</td>
                          <td className="py-2 pr-3 text-xs">
                            {verdict ? (
                              <span
                                className={
                                  "inline-flex items-center rounded-full px-3 py-1 text-[10px] font-semibold " +
                                  (ok
                                    ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                                    : "bg-red-100 text-red-700 border border-red-200")
                                }
                              >
                                {ok ? "GO" : "NO-GO"} — {verdict.reason}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-[10px]">
                                —
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-xs">
                            {!ok && verdict && (
                              <button
                                type="button"
                                onClick={() => setNoteContext({ slot, vessel, verdict })}
                                className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-[10px] text-red-700"
                              >
                                📄 Nota Técnica
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Nota técnica em tela (por embarcação/posição) */}
          {noteContext && !noteContext.verdict.ok && (
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
                    onClick={() => setNoteContext(null)}
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

                <div className="space-y-2 text-[11px] leading-relaxed text-gray-800">
                  <p>
                    Prezados,
                  </p>
                  <p>
                    Após a análise das condições meteoceanográficas vigentes e da aplicação dos
                    limites operacionais previstos para as manobras no Porto de Imbetiba, informamos
                    que a operação solicitada para a embarcação <strong>{noteContext.vessel.name}</strong>,
                    posicionada em <strong>{noteContext.slot.label}</strong>, foi classificada como
                    <strong> NO-GO</strong> no momento da avaliação.
                  </p>
                  <p>
                    No instante da avaliação, observou-se vento de {meto.wind} kn, com rajada
                    atingindo {meto.gust} kn, além de altura significativa de onda (Hs) de {meto.hs} m
                    e período de pico (Tp) de {meto.tp} s, circunstâncias que excedem os limites
                    operacionais definidos para o setor {meto.sector}.
                  </p>
                  <p>
                    Diante desse cenário, verificou-se que os parâmetros ambientais apresentaram
                    valores superiores ao permitido para uma manobra segura, resultando na aplicação
                    automática do critério de <strong>NO-GO</strong>, conforme registrado pelo sistema:
                    <strong> "{noteContext.verdict.reason}"</strong>.
                  </p>
                  <p>
                    Ressaltamos que a decisão refere-se exclusivamente ao momento da análise. As
                    condições encontram-se em monitoramento contínuo e, tão logo haja uma janela
                    operacional compatível com os limites estabelecidos, a equipe técnica sinalizará a
                    possibilidade de execução da manobra.
                  </p>
                </div>

                <div className="pt-2 mt-2 border-t">
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

                <div>
                  <p className="text-[10px] text-gray-500 italic mt-2">
                    Esta avaliação segue os parâmetros definidos no Estudo de Manobras realizado pela
                    Universidade de São Paulo (USP), validados pela Capitania dos Portos de Macaé e
                    incorporados integralmente na NPCP-CPM. Todas as informações aqui descritas
                    derivam de limites e diretrizes oficialmente estabelecidos para garantir a
                    segurança da navegação e das operações portuárias no Porto de Imbetiba.
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
                <button
                  type="button"
                  onClick={() => setShowAddModal(true)}
                  className="rounded-md border px-2 py-1 text-[10px] bg-black text-white"
                >
                  Adicionar embarcação
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
                            onClick={() => {
                              // Preenche a primeira posição livre com esta embarcação
                              setBerthAssignments((prev) => {
                                const next = { ...prev };
                                const usedIds = new Set(Object.values(next));
                                if (usedIds.has(v.id)) return next;
                                for (const slot of PIER_SLOTS) {
                                  if (!next[slot.id]) {
                                    next[slot.id] = v.id;
                                    break;
                                  }
                                }
                                return next;
                              });
                              setActiveTab("go");
                            }}
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

          {/* Popup de Adicionar Embarcação */}
          {showAddModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="w-[min(420px,95vw)] rounded-2xl bg-white p-4 shadow-xl space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold">Adicionar embarcação</h3>
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="rounded-md border px-2 py-1 text-[11px]"
                  >
                    Fechar
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">
                  Informe os dados básicos da embarcação para cadastro na base do SVNP.
                </p>

                <div className="space-y-2 text-sm">
                  <div>
                    <label className="text-xs text-gray-600">Nome</label>
                    <input
                      value={newVessel.name}
                      onChange={(e) =>
                        setNewVessel((prev) => ({ ...prev, name: e.target.value }))
                      }
                      className="mt-1 w-full border rounded-lg p-2 text-sm"
                      placeholder="Nome da embarcação"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-600">Categoria</label>
                      <select
                        value={newVessel.category}
                        onChange={(e) =>
                          setNewVessel((prev) => ({
                            ...prev,
                            category: e.target.value,
                          }))
                        }
                        className="mt-1 w-full border rounded-lg p-2 text-sm"
                      >
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="C">C</option>
                        <option value="Tanque">Tanque</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs text-gray-600">LOA (m)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={newVessel.loa}
                        onChange={(e) =>
                          setNewVessel((prev) => ({ ...prev, loa: e.target.value }))
                        }
                        className="mt-1 w-full border rounded-lg p-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600">Calado (m)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={newVessel.draft}
                        onChange={(e) =>
                          setNewVessel((prev) => ({ ...prev, draft: e.target.value }))
                        }
                        className="mt-1 w-full border rounded-lg p-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600">Boca (m)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={newVessel.beam}
                        onChange={(e) =>
                          setNewVessel((prev) => ({ ...prev, beam: e.target.value }))
                        }
                        className="mt-1 w-full border rounded-lg p-2 text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="rounded-md border px-3 py-1.5 text-xs"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const name = newVessel.name.trim();
                      if (!name) return;
                      upsertVessel({
                        name,
                        category: newVessel.category,
                        loa: newVessel.loa ? Number(newVessel.loa) : undefined,
                        draft: newVessel.draft
                          ? Number(newVessel.draft)
                          : undefined,
                        beam: newVessel.beam
                          ? Number(newVessel.beam)
                          : undefined,
                      });
                      setNewVessel({
                        name: "",
                        category: "A",
                        loa: "",
                        draft: "",
                        beam: "",
                      });
                      setShowAddModal(false);
                    }}
                    className="rounded-md border px-3 py-1.5 text-xs bg-black text-white"
                  >
                    Salvar embarcação
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
