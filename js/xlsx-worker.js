'use strict';

// 신뢰하지 않는 XLS/XLSX 파싱을 메인 UI 스레드와 격리한다.
importScripts('vendor/xlsx-0.20.3.full.min.js');

const MAX_ROWS = 20000;
const MAX_COLUMNS = 256;
const MAX_CELLS = 2000000;

self.addEventListener('message', event => {
    try {
        const workbook = XLSX.read(event.data.buffer, {
            type: 'array',
            dense: true,
            cellFormula: false,
            cellHTML: false,
            cellNF: false,
            cellStyles: false,
            WTF: false,
        });
        const sheetName = workbook.SheetNames[0];
        const sheet = sheetName && workbook.Sheets[sheetName];
        if (!sheetName || !sheet) throw new Error('첫 번째 시트를 찾을 수 없습니다.');

        const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
        const rows = range ? range.e.r - range.s.r + 1 : 0;
        const columns = range ? range.e.c - range.s.c + 1 : 0;
        if (rows > MAX_ROWS || columns > MAX_COLUMNS || rows * columns > MAX_CELLS) {
            throw new Error(`시트가 처리 한도를 초과합니다(최대 ${MAX_ROWS}행, ${MAX_COLUMNS}열, ${MAX_CELLS}셀).`);
        }

        const csvText = XLSX.utils.sheet_to_csv(sheet, { blankrows: true });
        self.postMessage({ ok: true, sheetName, csvText });
    } catch (error) {
        self.postMessage({ ok: false, error: error?.message || 'XLSX 파싱 실패' });
    }
});
