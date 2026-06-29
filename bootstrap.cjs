const http = require("node:http");

const port = Number(process.env.PORT || 3000);
console.log(`Inicializando aplicação na porta ${port}`);

import("./backend.js")
  .then(({ createApp }) => createApp())
  .then((app) => {
    const server = app.listen(port, "0.0.0.0", () => {
      console.log(`Servidor iniciado na porta ${port}`);
    });
    server.on("error", (error) => console.error("Falha no servidor:", error.message));
  })
  .catch((error) => {
    console.error("Falha ao iniciar a aplicação:", error.message);
    http.createServer((_request, response) => {
      response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Aplicação em configuração. Consulte os logs de execução.");
    }).listen(port, "0.0.0.0", () => console.log(`Servidor de diagnóstico iniciado na porta ${port}`));
  });
