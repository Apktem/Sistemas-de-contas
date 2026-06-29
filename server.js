import { createApp } from "./backend.js";

const port = Number(process.env.PORT || 3000);
const app = await createApp();

app.listen(port, "0.0.0.0", () => {
  console.log(`Servidor iniciado na porta ${port}`);
});
