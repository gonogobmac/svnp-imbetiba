// pages/api/vessels.js

export default async function handler(req, res) {
  const {
    GITHUB_TOKEN,
    GITHUB_OWNER,
    GITHUB_REPO,
    GITHUB_PATH = "data/vessels.json",
  } = process.env;

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return res
      .status(500)
      .json({ error: "Configuração GitHub ausente no servidor." });
  }

  const apiBase = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`;

  try {
    if (req.method === "GET") {
      const ghRes = await fetch(apiBase, {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      });

      if (ghRes.status === 404) {
        // Se ainda não existir o arquivo, devolve base vazia
        return res.status(200).json({ data: [], sha: null });
      }

      if (!ghRes.ok) {
        const txt = await ghRes.text();
        return res
          .status(ghRes.status)
          .json({ error: "Erro GitHub GET", details: txt });
      }

      const json = await ghRes.json();
      const content = Buffer.from(json.content, "base64").toString("utf8");
      const data = JSON.parse(content);

      return res.status(200).json({ data, sha: json.sha });
    }

    if (req.method === "PUT") {
      const { data, sha } = req.body; // data = vesselDB (array)

      const content = Buffer.from(JSON.stringify(data, null, 2)).toString(
        "base64"
      );

      const ghRes = await fetch(apiBase, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          message: "Atualização da base de embarcações (SVNP)",
          content,
          sha: sha || undefined, // se null/undefined, GitHub cria o arquivo
        }),
      });

      if (!ghRes.ok) {
        const txt = await ghRes.text();
        return res
          .status(ghRes.status)
          .json({ error: "Erro GitHub PUT", details: txt });
      }

      const json = await ghRes.json();

      return res.status(200).json({
        ok: true,
        sha: json.content.sha,
      });
    }

    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro inesperado", details: String(err) });
  }
}
