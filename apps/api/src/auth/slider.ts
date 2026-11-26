import { randomInt } from 'crypto';

export const SLIDER_WIDTH = 320;
export const SLIDER_HEIGHT = 160;
export const SLIDER_PIECE_SIZE = 44;
export const SLIDER_TOLERANCE = 8;

export interface SliderChallenge {
  /** 拼图块左边缘应在的目标 X（仅服务端保存） */
  targetX: number;
  width: number;
  height: number;
  pieceSize: number;
  /** 拼图块可拖动的纵向位置 */
  pieceY: number;
  background: string;
  piece: string;
}

function dataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function randomColor(seed: number): string {
  const hue = (seed * 47 + randomInt(0, 40)) % 360;
  return `hsl(${hue}, ${55 + randomInt(0, 20)}%, ${45 + randomInt(0, 15)}%)`;
}

function noiseShapes(): string {
  const shapes: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const cx = randomInt(10, SLIDER_WIDTH - 10);
    const cy = randomInt(10, SLIDER_HEIGHT - 10);
    const r = randomInt(8, 34);
    shapes.push(
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(255,255,255,${(randomInt(8, 26) / 100).toFixed(2)})" />`,
    );
  }
  for (let i = 0; i < 3; i += 1) {
    const x = randomInt(0, SLIDER_WIDTH - 80);
    const y = randomInt(0, SLIDER_HEIGHT - 20);
    shapes.push(
      `<rect x="${x}" y="${y}" width="${randomInt(40, 90)}" height="${randomInt(6, 16)}" rx="6" fill="rgba(255,255,255,${(
        randomInt(6, 18) / 100
      ).toFixed(2)})" transform="rotate(${randomInt(-20, 20)} ${x} ${y})" />`,
    );
  }
  return shapes.join('');
}

/** 自研图形滑块：服务端生成背景（含缺口）与拼图块，目标坐标只保存在服务端 */
export function createSliderChallenge(): SliderChallenge {
  const targetX = randomInt(110, SLIDER_WIDTH - SLIDER_PIECE_SIZE - 20);
  const pieceY = 42;
  const gapCx = targetX + SLIDER_PIECE_SIZE / 2;
  const gapCy = pieceY + SLIDER_PIECE_SIZE / 2;
  const hueA = randomInt(190, 240);
  const hueB = randomInt(240, 300);

  const backgroundSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDER_WIDTH}" height="${SLIDER_HEIGHT}" viewBox="0 0 ${SLIDER_WIDTH} ${SLIDER_HEIGHT}">` +
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="hsl(${hueA},70%,62%)"/><stop offset="100%" stop-color="hsl(${hueB},68%,48%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="${SLIDER_WIDTH}" height="${SLIDER_HEIGHT}" rx="10" fill="url(#bg)"/>` +
    noiseShapes() +
    `<circle cx="${gapCx}" cy="${gapCy}" r="20" fill="rgba(15,23,42,0.55)" stroke="rgba(255,255,255,0.55)" stroke-width="1.5"/>` +
    `</svg>`;

  const pieceSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDER_PIECE_SIZE}" height="${SLIDER_PIECE_SIZE}" viewBox="0 0 ${SLIDER_PIECE_SIZE} ${SLIDER_PIECE_SIZE}">` +
    `<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="${randomColor(3)}"/><stop offset="100%" stop-color="${randomColor(9)}"/>` +
    `</linearGradient></defs>` +
    `<circle cx="22" cy="22" r="20" fill="url(#p)" stroke="rgba(255,255,255,0.95)" stroke-width="2"/>` +
    `<circle cx="16" cy="15" r="5" fill="rgba(255,255,255,0.35)"/>` +
    `</svg>`;

  return {
    targetX,
    width: SLIDER_WIDTH,
    height: SLIDER_HEIGHT,
    pieceSize: SLIDER_PIECE_SIZE,
    pieceY,
    background: dataUri(backgroundSvg),
    piece: dataUri(pieceSvg),
  };
}

export function verifySliderPosition(targetX: number, submittedX: unknown, tolerance = SLIDER_TOLERANCE): boolean {
  const x = Number(submittedX);
  if (!Number.isFinite(x)) return false;
  if (x < 0 || x > SLIDER_WIDTH - SLIDER_PIECE_SIZE) return false;
  return Math.abs(x - targetX) <= tolerance;
}

export function sliderPayload(challenge: SliderChallenge) {
  return {
    background: challenge.background,
    piece: challenge.piece,
    width: challenge.width,
    height: challenge.height,
    pieceSize: challenge.pieceSize,
    pieceY: challenge.pieceY,
  };
}
