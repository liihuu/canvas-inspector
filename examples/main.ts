import "./example.css";
import { mountCanvasDevtools } from "../src/panel";
import { installCanvasDevtools } from "../src/registry";

const devtools = installCanvasDevtools({ captureStack: true, autoFrame: true });
mountCanvasDevtools({ target: document.body, devtools, position: "bottom", height: 430 });

const canvasElement = document.querySelector<HTMLCanvasElement>("#priceChart");
if (!canvasElement) throw new Error("Example canvas not found");
const canvas: HTMLCanvasElement = canvasElement;
const canvasContext = canvas.getContext("2d");
if (!canvasContext) throw new Error("Canvas 2D is not supported");
const context: CanvasRenderingContext2D = canvasContext;

interface Candle {
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

const candles: Candle[] = Array.from({ length: 52 }, (_, index) => {
  const base = 104 + Math.sin(index * 0.42) * 9 + index * 0.16;
  const open = base + Math.sin(index * 1.7) * 3;
  const close = base + Math.cos(index * 1.13) * 4;
  return {
    open,
    close,
    high: Math.max(open, close) + 2 + (index % 4),
    low: Math.min(open, close) - 2 - ((index + 2) % 3),
    volume: 20 + ((index * 17) % 68),
  };
});

let frame = 0;

function draw(): void {
  frame += 1;
  const width = canvas.width;
  const height = canvas.height;
  const left = 64;
  const right = 90;
  const top = 48;
  const priceBottom = 490;
  const volumeTop = 520;
  const bottom = 602;
  const drift = Math.sin(frame / 35) * 2.4;
  const visible = candles.map((item, index) =>
    index === candles.length - 1 ? { ...item, close: item.close + drift } : item,
  );
  const minimum = Math.min(...visible.map((item) => item.low)) - 3;
  const maximum = Math.max(...visible.map((item) => item.high)) + 3;
  const y = (price: number): number =>
    priceBottom - ((price - minimum) / (maximum - minimum)) * (priceBottom - top);
  const step = (width - left - right) / visible.length;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#11161b";
  context.fillRect(0, 0, width, height);
  context.lineWidth = 1;
  context.strokeStyle = "#29323b";
  context.fillStyle = "#798694";
  context.font = "12px ui-monospace, monospace";
  context.setLineDash([3, 5]);
  for (let index = 0; index <= 6; index += 1) {
    const rowY = top + ((priceBottom - top) / 6) * index;
    context.beginPath();
    context.moveTo(left, rowY);
    context.lineTo(width - right, rowY);
    context.stroke();
    context.fillText(
      (maximum - ((maximum - minimum) / 6) * index).toFixed(2),
      width - right + 12,
      rowY + 4,
    );
  }
  for (let index = 0; index <= 8; index += 1) {
    const columnX = left + ((width - left - right) / 8) * index;
    context.beginPath();
    context.moveTo(columnX, top);
    context.lineTo(columnX, bottom);
    context.stroke();
  }
  context.setLineDash([]);

  visible.forEach((item, index) => {
    const x = left + step * index + step / 2;
    const color = item.close >= item.open ? "#2ac59a" : "#f06470";
    context.strokeStyle = color;
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(x, y(item.high));
    context.lineTo(x, y(item.low));
    context.stroke();
    const bodyTop = y(Math.max(item.open, item.close));
    const bodyBottom = y(Math.min(item.open, item.close));
    context.fillRect(x - step * 0.3, bodyTop, step * 0.6, Math.max(2, bodyBottom - bodyTop));
    context.globalAlpha = 0.34;
    const volumeHeight = (item.volume / 90) * (bottom - volumeTop);
    context.fillRect(x - step * 0.3, bottom - volumeHeight, step * 0.6, volumeHeight);
    context.globalAlpha = 1;
  });

  const last = visible.at(-1);
  if (last) {
    context.strokeStyle = last.close >= last.open ? "#2ac59a" : "#f06470";
    context.fillStyle = context.strokeStyle;
    context.setLineDash([5, 4]);
    context.beginPath();
    context.moveTo(left, y(last.close));
    context.lineTo(width - right, y(last.close));
    context.stroke();
    context.setLineDash([]);
    context.fillRect(width - right + 8, y(last.close) - 11, 62, 22);
    context.fillStyle = "#fff";
    context.fillText(last.close.toFixed(2), width - right + 16, y(last.close) + 4);
    const priceLabel = document.querySelector<HTMLElement>("#lastPrice");
    if (priceLabel) priceLabel.textContent = last.close.toFixed(2);
  }
  context.fillStyle = "#edf2f7";
  context.font = "700 15px ui-sans-serif, sans-serif";
  context.fillText("BTC / USD", left, 26);
  context.fillStyle = "#7e8995";
  context.font = "11px ui-monospace, monospace";
  context.fillText("LIVE · CANVAS 2D", left + 98, 26);
  const frameLabel = document.querySelector<HTMLElement>("#frameLabel");
  if (frameLabel) frameLabel.textContent = `Frame ${frame}`;
  requestAnimationFrame(draw);
}

requestAnimationFrame(draw);
