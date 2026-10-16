import { mountCanvasDevtools } from "./panel";
import { installCanvasDevtools } from "./registry";

const devtools = installCanvasDevtools();

if (document.body) mountCanvasDevtools({ devtools });
else window.addEventListener("DOMContentLoaded", () => mountCanvasDevtools({ devtools }), { once: true });

export default devtools;
