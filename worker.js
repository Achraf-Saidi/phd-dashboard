// Le moteur Python est partagé avec l'exécution en ligne de commande.
let python;
async function initialize() {
  const { loadPyodide } = await import("https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs");
  python = await loadPyodide();
  await python.loadPackage("numpy");
  const response = await fetch("./experiment.py");
  if (!response.ok) throw new Error("Le fichier experiment.py est introuvable.");
  python.FS.writeFile("/home/pyodide/experiment.py", await response.text());
  await python.runPythonAsync("from experiment import *\nimport json\nimport numpy as np");
  python.globals.set("report_progress", (done, total) => postMessage({type: "progress", done, total}));
  postMessage({type: "ready", numpy: python.runPython("np.__version__")});
}
const ready = initialize().catch(error => postMessage({type: "error", message: String(error)}));
self.onmessage = async ({data}) => {
  try {
    await ready;
    if (!python) throw new Error("Le moteur Python n'est pas disponible. Rechargez la page.");
    python.globals.set("config_json", JSON.stringify(data.config));
    const functionCall = data.type === "trajectory" ? "trajectory(cfg)" : "monte_carlo(cfg, report_progress)";
    const result = await python.runPythonAsync(`cfg = Config(**json.loads(config_json))\njson.dumps(${functionCall}, allow_nan=False)`);
    postMessage({type: data.type, result: JSON.parse(result)});
  } catch (error) { postMessage({type: "error", message: String(error)}); }
};
