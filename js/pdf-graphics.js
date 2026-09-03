/* ===================================================================
 * [pdf-graphics.js] PDF 그림과 괘선 뽑기
 * ===================================================================
 * `getTextContent()`는 글자만 준다. 그림과 표 괘선은 **연산자 목록**에만
 * 있다. 지금까지 PDF 변환이 그림을 통째로 잃고, 열 간격이 좁은 표를 못 읽은
 * 이유가 이것이다.
 *
 * 두 가지를 뽑는다.
 *   그림  `paintImageXObject` + `page.objs` → 픽셀. 놓인 자리와 크기는 CTM에서.
 *   괘선  `constructPath` → 가로·세로 선분. 표의 격자를 여기서 얻는다.
 *
 * ── CTM을 제대로 쌓아야 한다 ──
 * 연산자 하나의 `transform` 인자만 보면 안 된다. `save`/`restore`로 쌓인
 * 행렬이 모두 곱해진 것이 실제 좌표다. 마지막 transform만 보면 그림 크기가
 * 페이지 배율만큼 어긋난다(실제로 375×250으로 잘못 나왔다).
 *
 * ── PNG로 굽는 이유 ──
 * pdf.js는 그림을 **디코딩된 픽셀**로 준다(JPEG 원본이 아니라 RGBA). HWPX에
 * 넣으려면 다시 인코딩해야 한다. `CompressionStream('deflate')`은 브라우저와
 * Node에 모두 있어 vendor를 늘리지 않고 진짜 zlib 압축을 쓸 수 있다.
 * ===================================================================*/

'use strict';

/** 행렬 곱 [a,b,c,d,e,f]. PDF 좌표계 규약 그대로. */
function mul(m1, m2) {
    return [
        m1[0] * m2[0] + m1[2] * m2[1],
        m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3],
        m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
        m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
}

/** pdf.js ImageKind. 1=회색1bpp, 2=RGB 24bpp, 3=RGBA 32bpp. */
const KIND_GRAYSCALE_1BPP = 1;
const KIND_RGB_24BPP = 2;
const KIND_RGBA_32BPP = 3;

/**
 * 어떤 형태로 오든 RGBA로 편다.
 *
 * ⚠ **브라우저와 Node가 서로 다른 것을 준다.**
 *   브라우저(OffscreenCanvas 지원): `{ bitmap: ImageBitmap, width, height }`
 *   Node(대체 경로):                `{ data, kind, width, height }`
 *
 * bitmap 쪽을 처리하지 않으면 **브라우저에서만 그림이 조용히 사라진다.**
 * Node 테스트만 돌리면 못 잡는다 — 실제로 그렇게 놓칠 뻔했다.
 */
function toRgba(img) {
    const { width: w, height: h, kind, data } = img;
    if (!w || !h) return null;

    // ImageBitmap → 캔버스에 그려 픽셀을 꺼낸다.
    if (img.bitmap) {
        try {
            const canvas = typeof OffscreenCanvas === 'function'
                ? new OffscreenCanvas(w, h)
                : Object.assign(document.createElement('canvas'), { width: w, height: h });
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return null;
            ctx.drawImage(img.bitmap, 0, 0);
            return new Uint8Array(ctx.getImageData(0, 0, w, h).data.buffer);
        } catch {
            return null;
        }
    }

    if (!data) return null;
    const out = new Uint8Array(w * h * 4);

    if (kind === KIND_RGBA_32BPP) {
        out.set(data.subarray(0, Math.min(data.length, out.length)));
        return out;
    }
    if (kind === KIND_RGB_24BPP) {
        for (let i = 0, o = 0; o < out.length; i += 3, o += 4) {
            out[o] = data[i]; out[o + 1] = data[i + 1]; out[o + 2] = data[i + 2]; out[o + 3] = 255;
        }
        return out;
    }
    if (kind === KIND_GRAYSCALE_1BPP) {
        // 1bpp는 행마다 바이트 경계로 채워진다(rowBytes).
        const rowBytes = (w + 7) >> 3;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
                const v = bit ? 255 : 0;
                const o = (y * w + x) * 4;
                out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
            }
        }
        return out;
    }
    return null;
}

/** adler32 — zlib 스트림 꼬리에 필요하다. */
function adler32(buf) {
    let a = 1, b = 0;
    for (let i = 0; i < buf.length; i++) {
        a = (a + buf[i]) % 65521;
        b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

/** raw deflate로 압축한다. 못 하면 null — 호출자가 무압축으로 간다. */
async function deflateRaw(bytes) {
    if (typeof CompressionStream !== 'function') return null;
    try {
        const cs = new CompressionStream('deflate');
        const writer = cs.writable.getWriter();
        writer.write(bytes);
        writer.close();
        const buf = await new Response(cs.readable).arrayBuffer();
        return new Uint8Array(buf);   // 'deflate' = zlib 헤더 포함
    } catch {
        return null;
    }
}

/** 압축이 안 될 때 쓰는 zlib "저장" 블록. 크지만 항상 옳다. */
function zlibStored(bytes) {
    const blocks = [];
    const MAX = 65535;
    for (let off = 0; off < bytes.length || off === 0; off += MAX) {
        const chunk = bytes.subarray(off, Math.min(off + MAX, bytes.length));
        const last = off + MAX >= bytes.length ? 1 : 0;
        const head = new Uint8Array(5);
        head[0] = last;
        head[1] = chunk.length & 0xFF;
        head[2] = (chunk.length >> 8) & 0xFF;
        head[3] = (~chunk.length) & 0xFF;
        head[4] = ((~chunk.length) >> 8) & 0xFF;
        blocks.push(head, chunk);
        if (last) break;
    }
    const size = blocks.reduce((n, b) => n + b.length, 0);
    const out = new Uint8Array(2 + size + 4);
    out[0] = 0x78; out[1] = 0x01;                  // zlib 헤더(무압축)
    let o = 2;
    for (const b of blocks) { out.set(b, o); o += b.length; }
    const sum = adler32(bytes);
    out[o] = (sum >>> 24) & 0xFF; out[o + 1] = (sum >>> 16) & 0xFF;
    out[o + 2] = (sum >>> 8) & 0xFF; out[o + 3] = sum & 0xFF;
    return out;
}

function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

/**
 * RGBA 픽셀을 PNG 바이트로 굽는다.
 * 필터는 쓰지 않는다(각 행 앞에 0). 압축률보다 단순함과 이식성이 낫다.
 */
export async function encodePng(rgba, w, h) {
    const raw = new Uint8Array(h * (1 + w * 4));
    for (let y = 0; y < h; y++) {
        raw[y * (1 + w * 4)] = 0;
        raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1);
    }
    const compressed = (await deflateRaw(raw)) || zlibStored(raw);

    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w);
    dv.setUint32(4, h);
    ihdr[8] = 8;    // bit depth
    ihdr[9] = 6;    // color type 6 = RGBA
    // 10,11,12 = compression/filter/interlace = 0

    const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', new Uint8Array(0))];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

/** 0~1 실수 3개를 #rrggbb로. */
function rgbHex(r, g, b) {
    const h = v => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}

/** CTM이 놓은 자리와 크기. 단위 정사각형을 변환한 결과다. */
function placed(key, ctm) {
    return {
        key,
        wPt: Math.hypot(ctm[0], ctm[1]),
        hPt: Math.hypot(ctm[2], ctm[3]),
        x: ctm[4],
        // d가 음수면 CTM이 y를 뒤집은 것이라 f가 그림의 **위쪽**이다.
        y: ctm[3] < 0 ? ctm[5] - Math.abs(ctm[3]) : ctm[5],
    };
}

/** page.objs는 콜백형과 Promise형이 섞여 있다. 둘 다 받는다. */
function getObj(page, key) {
    // 여러 페이지에서 재사용되는 그림(그리고 25만 픽셀이 넘는 큰 그림)은
    // page.objs가 아니라 commonObjs에 들어간다. 한쪽만 보면 정확히 우리가
    // 꺼내고 싶은 **큰 그림들**을 놓친다.
    const store = key.startsWith('g_') ? page.commonObjs : page.objs;
    return new Promise(resolve => {
        try {
            // 인자 없는 get()은 아직 해결 안 된 객체에서 예외를 던진다.
            // 그래서 준비된 것만 그렇게 읽고, 아직이면 **콜백형**으로 기다린다.
            // has()가 false라고 없는 게 아니다 — 곧 도착할 수도 있다.
            // 여기서 포기하면 그림이 조용히 사라진다(실제로 그랬다).
            if (store.has(key)) { resolve(store.get(key)); return; }
            store.get(key, resolve);
        } catch {
            resolve(null);
        }
    });
}

/**
 * 페이지의 그림과 괘선을 한 번에 훑는다.
 *
 * 연산자 목록은 한 번만 읽는다 — 그림·괘선·색을 각각 읽으면 큰 문서에서
 * 같은 일을 세 번 한다.
 *
 * @returns {Promise<{images:object[], hLines:object[], vLines:object[]}>}
 *   좌표는 모두 PDF 사용자 공간(왼쪽 아래 원점, 1pt 단위).
 */
export async function extractGraphics(page, OPS) {
    let ops;
    try {
        ops = await page.getOperatorList();
    } catch {
        return { images: [], hLines: [], vLines: [], colorChars: [], fills: [] };
    }

    const images = [];
    const hLines = [];
    const vLines = [];
    // 채워진 면 = 셀 배경(음영). 표 셀에 색을 돌려주려면 이것도 모아야 한다.
    const fills = [];
    // 글자마다의 색. getTextContent()는 색이 바뀌어도 조각을 합쳐서 주므로
    // 색만은 여기서 글리프 단위로 모아야 한다.
    const colorChars = [];
    let fill = '#000000';

    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];

    for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i];

        if (fn === OPS.setFillRGBColor) {
            // v6는 이미 '#rrggbb' 문자열로 준다. 숫자 3개로 오는 판본도 대비한다.
            fill = typeof args[0] === 'string' ? args[0] : rgbHex(args[0], args[1], args[2]);
        } else if (fn === OPS.setFillGray) {
            fill = rgbHex(args[0], args[0], args[0]);
        } else if (fn === OPS.setFillCMYKColor) {
            const [c, m, y, k] = args;
            fill = rgbHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
        } else if (fn === OPS.showText) {
            for (const g of args[0] || []) {
                // 숫자는 자간 조정값이지 글자가 아니다.
                if (!g || typeof g !== 'object') continue;
                if (typeof g.unicode === 'string' && g.unicode.length) {
                    colorChars.push({ u: g.unicode, color: fill });
                }
            }
        } else if (fn === OPS.save) {
            stack.push(ctm.slice());
        } else if (fn === OPS.restore) {
            ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
        } else if (fn === OPS.transform) {
            ctm = mul(ctm, args);
        } else if (fn === OPS.constructPath) {
            collectLines(args, ctm, hLines, vLines, OPS);
            collectFill(args, ctm, fill, fills, OPS);
        } else if (fn === OPS.paintImageXObject) {
            // 그림은 언제나 단위 정사각형에 그려진다. 실제 크기·자리는 CTM이 정한다.
            if (typeof args[0] === 'string') images.push(placed(args[0], ctm));
        } else if (fn === OPS.paintImageXObjectRepeat) {
            // 같은 그림을 여러 자리에 반복해 그린다. 놓치면 하나만 나온다.
            const [key, scaleX, scaleY, positions] = args;
            for (let k = 0; k + 1 < (positions || []).length; k += 2) {
                const m = mul(ctm, [scaleX, 0, 0, scaleY, positions[k], positions[k + 1]]);
                if (typeof key === 'string') images.push(placed(key, m));
            }
        }
    }

    // 픽셀은 필요한 것만 뒤늦게 가져온다.
    for (const img of images) {
        const obj = await getObj(page, img.key);
        if (!obj) continue;
        const rgba = toRgba(obj);
        if (!rgba) continue;
        img.pxWidth = obj.width;
        img.pxHeight = obj.height;
        img.rgba = rgba;
    }

    return { images: images.filter(i => i.rgba), hLines, vLines, colorChars, fills };
}

/**
 * `constructPath`에서 **표 괘선**을 골라낸다.
 *
 * ── 인자 모양(v6.3에서 실측) ──
 *   args = [paintOp, [Float32Array], bbox]
 *   args[2] = [minX, minY, maxX, maxY] — **경로 bbox를 공짜로 준다.**
 *             좌표를 직접 훑어 계산할 필요가 없다.
 *
 * ── 괘선은 "선"이 아니라 "얇고 긴 사각형"이다 ──
 * 실측하면 표 괘선 하나가 `(76,145)→(77,145)→(77,174)→(76,174)` 처럼
 * 폭 1pt짜리 채워진 사각형으로 온다. 그래서 bbox의 짧은 변이 충분히 얇으면
 * 괘선으로 본다. 획(stroke)으로 그린 표는 bbox의 짧은 변이 0이라 같이 걸린다.
 *
 * 비스듬한 선은 표가 아니라 그림이므로 넣지 않는다 — 넣으면 도형이 있는
 * 문서가 전부 표가 된다. bbox만 쓰면 대각선도 큰 사각형으로 보이지만,
 * 그런 것은 짧은 변이 두꺼워 자연히 걸러진다.
 *
 * ⚠ 이 인자는 pdf.js가 렌더링할 때 **제자리에서 Path2D로 바뀐다.**
 *   그래서 같은 OperatorList로 렌더링하기 전에 읽어야 한다.
 */
function collectLines(args, ctm, hLines, vLines, OPS) {
    const paintOp = args[0];
    const bbox = args[2];
    if (!bbox) return;

    // 칠하거나 그은 경로만 괘선 후보다. 클립 경로는 표가 아니다.
    const painted = paintOp === OPS.fill || paintOp === OPS.eoFill
        || paintOp === OPS.stroke || paintOp === OPS.closeStroke
        || paintOp === OPS.fillStroke || paintOp === OPS.eoFillStroke;
    if (!painted) return;

    const MAX_THICK = 2.5;   // 이보다 두꺼우면 괘선이 아니라 덩어리다
    const MIN_LEN = 8;       // 이보다 짧으면 격자 근거로 쓰지 않는다

    const pt = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
    const addSeg = (ax, ay, bx, by) => {
        const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
        const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
        const w = x1 - x0, h = y1 - y0;
        if (h <= MAX_THICK && w >= MIN_LEN) hLines.push({ y: (y0 + y1) / 2, x1: x0, x2: x1 });
        else if (w <= MAX_THICK && h >= MIN_LEN) vLines.push({ x: (x0 + x1) / 2, y1: y0, y2: y1 });
    };

    const stroked = paintOp === OPS.stroke || paintOp === OPS.closeStroke
        || paintOp === OPS.fillStroke || paintOp === OPS.eoFillStroke;

    if (stroked) {
        // ── 획으로 그린 표는 bbox로 보면 안 된다 ──
        // 사각형을 획으로 그리면 `constructPath` 하나에 네 변이 다 들어가고
        // bbox는 **상자 전체**가 된다. 얇지 않으니 통째로 버려져 **괘선이
        // 하나도 안 잡힌다.** 그래서 좌표를 직접 훑어 변마다 따로 낸다.
        //
        // DrawOPS(v6에서 실측): 0=moveTo(2) 1=lineTo(2) 2=curveTo(6)
        //                      3=quadraticCurveTo(4) 4=closePath(0)
        // 이 상수는 pdf.js가 내보내지 않아 숫자로 적을 수밖에 없다.
        const stream = Array.isArray(args[1]) ? args[1][0] : args[1];
        if (!stream) return;
        let cx = 0, cy = 0, sx = 0, sy = 0;
        for (let i = 0; i < stream.length;) {
            const op = stream[i++];
            if (op === 0) {                       // moveTo
                cx = stream[i++]; cy = stream[i++]; sx = cx; sy = cy;
            } else if (op === 1) {                // lineTo
                const nx = stream[i++], ny = stream[i++];
                const [ax, ay] = pt(cx, cy);
                const [bx, by] = pt(nx, ny);
                addSeg(ax, ay, bx, by);
                cx = nx; cy = ny;
            } else if (op === 2) {                // curveTo — 곡선은 표가 아니다
                i += 6; cx = stream[i - 2]; cy = stream[i - 1];
            } else if (op === 3) {                // quadraticCurveTo
                i += 4; cx = stream[i - 2]; cy = stream[i - 1];
            } else if (op === 4) {                // closePath
                const [ax, ay] = pt(cx, cy);
                const [bx, by] = pt(sx, sy);
                addSeg(ax, ay, bx, by);
                cx = sx; cy = sy;
            } else {
                break;                            // 모르는 연산자 — 더 읽지 않는다
            }
        }
        return;
    }

    // 채우기로 그린 괘선은 **얇고 긴 사각형**이라 bbox만으로 충분하다.
    const [ax, ay] = pt(bbox[0], bbox[1]);
    const [bx, by] = pt(bbox[2], bbox[3]);
    addSeg(ax, ay, bx, by);
}

/**
 * 채워진 **면**을 모은다 — 표 셀의 음영이다.
 *
 * `collectLines`는 얇은 것만 괘선으로 가져가고 나머지를 버린다. 그런데 그
 * 버려지는 것들 중에 **셀 배경색**이 있다. 실측하면 23쪽 문서에서 208개가
 * 버려지고 있었고, 그 탓에 표 머리행이 **흰 글자 + 배경 없음**이 되어
 * 한글에서 글자가 보이지 않았다(흰 바탕에 흰 글자).
 *
 * 흰색은 기본 바탕이라 넣지 않는다 — 넣어 봐야 달라지는 것이 없고
 * borderFill만 늘어난다.
 */
function collectFill(args, ctm, color, out, OPS) {
    const paintOp = args[0];
    const bbox = args[2];
    if (!bbox) return;
    if (paintOp !== OPS.fill && paintOp !== OPS.eoFill && paintOp !== OPS.fillStroke) return;
    if (!color || /^#f{6}$/i.test(color)) return;      // 흰 바탕은 의미 없다

    const pt = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
    const [ax, ay] = pt(bbox[0], bbox[1]);
    const [bx, by] = pt(bbox[2], bbox[3]);
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
    const y0 = Math.min(ay, by), y1 = Math.max(ay, by);

    // 얇은 것은 괘선이지 배경이 아니다.
    if (Math.min(x1 - x0, y1 - y0) <= 2.5) return;
    out.push({ x0, y0, x1, y1, color });
}
