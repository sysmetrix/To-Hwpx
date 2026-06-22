/* ===================================================================
 * [app.js]  UI 이벤트 처리 · 드래그앤드롭 · 7단계 변환 파이프라인 제어
 * ===================================================================
 * 이 파일은 화면 조작(UI)만 담당함
 *   - HWPX 생성 로직 → hwpx.js
 *   - 포맷 파싱 로직 → parsers.js
 *
 * [수정 가이드]
 *   UI 요소 ID 변경 → index.html과 이 파일의 getElementById() 동기화 필요
 *   포맷 탭/카드 추가 → index.html의 .format-card 추가 후 PARSERS(parsers.js) 업데이트
 *   파이프라인 단계 추가 → PIPELINE_STEPS 배열에 항목 추가 + index.html 스텝 요소 추가
 * ===================================================================*/

'use strict';

// ─────────────────────────────────────────────────────────────────────────
// [전역 상태]
//   현재 변환 세션 정보를 저장. 페이지 리로드 시 초기화됨
//   [주의] 민감한 문서 내용은 state에 장기 저장하지 않음 (privacy)
// ─────────────────────────────────────────────────────────────────────────
const state = {
    file:         null,                // 선택된 File 객체
    ir:           null,                // 파싱 완료된 IR JSON
    docType:      'plain',             // 문서 유형: "official" | "report" | "plain"
    customTitle:  '',                  // 사용자가 입력한 제목 (비어 있으면 파서가 자동 감지)
    docFont:      '맑은 고딕',          // 출력 폰트 (기본: 맑은 고딕)
    fontSize:     12,                  // 기본 글꼴 크기 (pt)
    paperSize:    'A4',                // 용지 크기: "A4" | "B5" | "Letter"
    orientation:  'portrait',          // 용지 방향: "portrait" | "landscape"
    pageMargins:  { top: 10, bottom: 10, left: 20, right: 20, header: 10, footer: 10 },  // 단위: mm
    autoDownload: true,                // 변환 완료 시 자동 다운로드
    isConverting: false,               // 변환 중 중복 실행 방지 플래그
    hwpxBlob:    null,                 // 미리보기용 마지막 변환 결과 Blob
    downloadUrl: null,                 // 마지막 변환 결과 Blob URL
    downloadTimer: null                // Blob URL 해제 타이머
};

// ─────────────────────────────────────────────────────────────────────────
// [7단계 파이프라인 정의]
//   ref/hwpx-agent-loop-guide.html의 7단계 변환 흐름을 UI에 반영
//   [수정 시] 단계 추가/삭제 후 renderPipelineSteps()로 DOM을 재렌더링해야 함
// ─────────────────────────────────────────────────────────────────────────
const PIPELINE_STEPS = [
    { id: 'ingest',    label: '파일 읽기',      icon: '📥' },
    { id: 'normalize', label: 'IR 변환',        icon: '🔄' },
    { id: 'generate',  label: 'HWPX 생성',     icon: '⚙️'  },
    { id: 'validate',  label: '구조 검증',      icon: '✅'  },
    { id: 'preview',   label: '미리보기',       icon: '👁️'  },
    { id: 'repair',    label: '자동 수정',      icon: '🔧'  },
    { id: 'ship',      label: '다운로드 준비',  icon: '📦'  },
];

const SUPPORTED_EXTENSIONS = new Set([
    'md', 'markdown', 'html', 'htm', 'txt', 'text',
    'csv', 'xlsx', 'xls', 'json', 'ipynb', 'docx', 'hwp', 'hwpx',
]);
const BINARY_EXTENSIONS = new Set(['xlsx', 'xls', 'docx', 'hwp', 'hwpx']);
const SUPPORTED_FORMAT_LABEL = 'MD, HTML, TXT, CSV, XLSX, JSON, IPYNB, DOCX, HWP, HWPX';

// ─────────────────────────────────────────────────────────────────────────
// [DOM 준비 후 초기화]
//   모든 기능 초기화를 DOMContentLoaded 이후 실행
// ─────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    renderPipelineSteps();      // 파이프라인 단계 DOM 렌더링
    setProgressPanelState('empty');
    initDropZone();             // 파일 드롭/선택 영역 (히어로 드롭존)
    initConverterDropArea();    // 변환기 섹션 통합 드롭 영역
    initFormatTabs();           // 포맷 탭 전환 (기본/확장 서비스)
    initFormatCards();          // 포맷 카드 클릭 이벤트
    initOptions();              // 문서 유형·제목·폰트·여백 옵션
    initConvertButton();        // 변환 시작 버튼 + Ctrl+Enter 단축키
    initScrollBehavior();       // 스크롤 시 헤더 효과
    initMobileMenu();           // 모바일 햄버거 메뉴
    initNavLinks();             // 부드러운 스크롤 네비게이션
    initModals();               // 미리보기·업데이트 내역 모달
    initBookmarkButton();       // 즐겨찾기 안내 버튼
    initResetButton();          // 현재 선택 파일과 변환 옵션 초기화
});


// ─────────────────────────────────────────────────────────────────────────
// [파이프라인 단계 UI]
// ─────────────────────────────────────────────────────────────────────────

/** PIPELINE_STEPS 배열로 DOM 렌더링 */
function renderPipelineSteps() {
    const container = document.getElementById('pipeline-steps');
    if (!container) return;

    container.innerHTML = PIPELINE_STEPS.map((step, i) => `
        <div class="pipeline-step step-pending" id="step-${step.id}">
            <div class="step-bubble">
                <span class="step-num">${i + 1}</span>
                <span class="step-icon-done">✓</span>
            </div>
            <div class="step-label">${step.icon} ${step.label}</div>
        </div>
    `).join('');
}

/**
 * 특정 파이프라인 단계의 상태 변경
 * @param {string} stepId  - PIPELINE_STEPS의 id 값
 * @param {string} status  - 'pending' | 'active' | 'done' | 'error'
 */
function setStepState(stepId, status) {
    const el = document.getElementById(`step-${stepId}`);
    if (!el) return;
    // 기존 상태 클래스를 모두 제거하고 새 상태 적용
    el.className = `pipeline-step step-${status}`;
}

/** 모든 단계를 초기(pending) 상태로 리셋 */
function resetPipeline() {
    PIPELINE_STEPS.forEach(s => setStepState(s.id, 'pending'));
    setProgress(0);
    setProgressValue(0);
    setStatusText('대기 중');
}


// ─────────────────────────────────────────────────────────────────────────
// [파일 드롭존 + 파일 선택]
// ─────────────────────────────────────────────────────────────────────────
function initDropZone() {
    const dropZone  = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    if (!dropZone || !fileInput) return;

    // 클릭 → 숨겨진 <input type="file"> 트리거
    dropZone.addEventListener('click', (e) => {
        // 드롭존 내부의 버튼(다른 파일 선택)을 클릭한 경우 제외
        if (e.target.classList.contains('file-change')) return;
        fileInput.click();
    });

    // <input> 파일 선택 완료 이벤트
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFileList(e.target.files);
            // 같은 파일을 다시 선택할 수 있도록 value 초기화
            e.target.value = '';
        }
    });

    // 드래그 오버: 시각적 피드백(테두리 강조)
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', (e) => {
        // 드롭존 영역 완전 이탈 시만 제거 (자식 요소 이동 시 이탈 방지)
        if (!dropZone.contains(e.relatedTarget)) {
            dropZone.classList.remove('drag-over');
        }
    });

    // 파일 드롭
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
        handleFileList(e.dataTransfer.files);
    });

    // 페이지 전체 드롭 방지 (드롭존 외부에 놓으면 브라우저가 파일을 열어버리는 것 방지)
    document.addEventListener('dragover',  (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        // 드롭존 영역이 아닌 곳에 드롭해도 처리
        if (file) handleFileList(e.dataTransfer.files);
    });
}

function handleFileList(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length > 1) {
        showAlert(`여러 파일이 선택되었습니다. 현재는 한 번에 1개 파일만 변환합니다. 첫 번째 파일 "${files[0].name}"만 사용합니다.`);
    }
    handleFileSelect(files[0]);
}

/**
 * 파일 선택 처리
 * 상태 업데이트 → 포맷 감지 → UI 갱신 → 이전 결과 초기화
 */
function handleFileSelect(file) {
    const ext = getFileExtension(file.name);
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
        clearSelectedFile();
        showAlert(`지원하지 않는 파일 형식입니다: ${ext ? '.' + ext : '확장자 없음'}\n입력 가능 포맷: ${SUPPORTED_FORMAT_LABEL}\n출력: HWPX`);
        return;
    }

    // 포맷별 클라이언트 사이드 크기 사전 검사
    const isBinary = BINARY_EXTENSIONS.has(ext);
    const MAX_MB   = isBinary ? 50 : 100;
    if (file.size > MAX_MB * 1024 * 1024) {
        clearSelectedFile();
        showAlert(`파일 크기 초과: ${(file.size / 1024 / 1024).toFixed(1)}MB\n최대 ${MAX_MB}MB까지 변환할 수 있습니다. 큰 문서는 나누어 변환해 주세요.`);
        return;
    }

    state.file = file;
    state.ir   = null;
    state.hwpxBlob = null;
    revokeDownloadUrl();
    updateDropZoneUI(file, ext);     // 드롭존에 파일 정보 표시
    updateFormatBadge(ext);          // 감지된 포맷 배지 표시
    updateFormatExpectation(ext);     // 포맷별 보존/손실 기대치 안내
    updateConvertButton(true);       // 변환 버튼 활성화
    hideResult();                    // 이전 변환 결과 숨기기
    resetPipeline();                 // 파이프라인 초기화
    setProgressPanelState('ready');

    // 문서 제목 입력 placeholder를 파일명(확장자 제외)으로 설정
    const titleInput = document.getElementById('doc-title');
    if (titleInput) {
        titleInput.placeholder = file.name.replace(/\.[^.]+$/, '');
    }

    // 변환기 패널로 부드럽게 스크롤
    document.getElementById('converter')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearSelectedFile() {
    state.file = null;
    state.ir = null;
    state.hwpxBlob = null;
    revokeDownloadUrl();
    hideResult();
    resetPipeline();
    setProgressPanelState('empty');
    updateConvertButton(false);

    const badge = document.getElementById('detected-format');
    if (badge) {
        badge.textContent = '';
        badge.style.display = 'none';
    }

    const dz = document.getElementById('drop-zone');
    if (dz) {
        dz.innerHTML = `
            <div class="drop-icon">📂</div>
            <div class="drop-title">파일을 여기에 드래그하거나 클릭하세요</div>
            <div class="drop-sub">입력 포맷: MD · HTML · TXT · CSV · XLSX · JSON · IPYNB · DOCX<br>출력: HWPX</div>
        `;
    }

    const cda = document.getElementById('converter-drop-area');
    const cdaLabel = document.getElementById('cda-label');
    if (cda) cda.classList.remove('has-file');
    if (cdaLabel) cdaLabel.textContent = '파일을 드래그하거나 클릭하여 선택';

    const hint = document.getElementById('format-hint');
    if (hint) {
        hint.style.display = 'none';
        hint.innerHTML = '';
    }

    const titleInput = document.getElementById('doc-title');
    if (titleInput) {
        titleInput.value = '';
        titleInput.placeholder = '파일 선택 시 자동 입력';
    }

    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.value = '';
}

/** 드롭존 내부 UI를 파일 선택 상태로 업데이트 */
function updateDropZoneUI(file, ext) {
    const dz = document.getElementById('drop-zone');
    if (dz) {
        dz.innerHTML = `
            <div class="file-selected-info">
                <span class="file-emoji">${getFormatIcon(ext)}</span>
                <div class="file-meta">
                    <strong class="file-name">${escHtml(file.name)}</strong>
                    <span class="file-size">${formatBytes(file.size)}</span>
                </div>
                <button class="file-change" onclick="document.getElementById('file-input').click()">
                    다른 파일 선택
                </button>
            </div>
        `;
    }

    // 변환기 섹션 통합 드롭 영역도 선택된 파일 반영
    const cda      = document.getElementById('converter-drop-area');
    const cdaLabel = document.getElementById('cda-label');
    if (cda)      cda.classList.add('has-file');
    if (cdaLabel) cdaLabel.textContent = `${file.name}  (${formatBytes(file.size)}) — 다른 파일 선택`;
}

/** 감지된 포맷 배지 업데이트 */
function updateFormatBadge(ext) {
    const badge = document.getElementById('detected-format');
    if (!badge) return;
    badge.textContent   = ext.toUpperCase();
    badge.style.display = 'inline-block';
}

function qualityText(stars = '') {
    const count = (String(stars).match(/★/g) || []).length;
    if (count >= 3) return '보존도 높음';
    if (count === 2) return '보존도 보통';
    return '텍스트 중심 변환';
}

function getFormatInfoForExt(ext) {
    const aliases = {
        markdown: 'md',
        htm: 'html',
        xls: 'xlsx',
        hwpx: 'hwp',
    };
    return FORMAT_INFO[ext] || FORMAT_INFO[aliases[ext]] || null;
}

function updateFormatExpectation(ext, waiting = false) {
    const hint = document.getElementById('format-hint');
    if (!hint || !ext) return;
    const info = getFormatInfoForExt(ext) || { name: ext.toUpperCase(), quality: '★☆☆' };
    const summary = getConversionSummaryForExt(ext);
    const prefix = waiting ? `.${ext.toUpperCase()} 파일을 업로드하세요` : `${info.name} 감지`;
    hint.innerHTML = `
        <div class="format-hint-head">
            <strong>${escHtml(prefix)}</strong>
            <span>${escHtml(qualityText(info.quality))}</span>
        </div>
        <div class="format-hint-body">
            <span><b>보존</b> ${escHtml(summary.preserved)}</span>
            <span><b>확인</b> ${escHtml(summary.lossy)}</span>
        </div>
    `;
    hint.style.display = 'block';
}

function getFileExtension(fileName) {
    const parts = String(fileName || '').split('.');
    return parts.length > 1 ? parts.pop().toLowerCase().trim() : '';
}


// ─────────────────────────────────────────────────────────────────────────
// [포맷 탭 전환]
//   기본 서비스 / 확장 서비스 탭 클릭 시 해당 패널 표시
// ─────────────────────────────────────────────────────────────────────────
function initFormatTabs() {
    const tabs = document.querySelectorAll('.format-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // 모든 탭 비활성화 후 클릭된 탭만 활성화
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // 연결된 패널 표시 (data-target 속성으로 매핑)
            const targetId = tab.dataset.target;
            document.querySelectorAll('.format-panel').forEach(panel => {
                panel.classList.toggle('active', panel.id === targetId);
            });
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────
// [포맷 상세 데이터]  카드 팝업에 표시할 포맷별 변환 정보
// ─────────────────────────────────────────────────────────────────────────
const FORMAT_INFO = {
    md: {
        icon: '📝', name: 'Markdown',
        quality: '★★★', available: true,
        desc: 'Git, Notion 등 개발 문서 도구에서 널리 쓰이는 텍스트 기반 마크업 언어입니다.',
        tech: 'marked.js → HTML 파싱 → IR(중간 표현) → HWPX',
        features: [
            '제목(H1~H6), 굵기, 기울임, 취소선 지원',
            '표(GitHub Flavored Markdown) 지원',
            '순서/비순서 목록, 인용문 지원',
            '코드블록(펜스 코드·인라인 코드) 지원',
            '이모지, 수평선 지원',
        ],
        limits: ['이미지 미지원', '인라인 HTML 일부 무시'],
    },
    html: {
        icon: '🌐', name: 'HTML 문서',
        quality: '★★☆', available: true,
        desc: '웹 브라우저가 렌더링하는 마크업 언어 파일입니다.',
        tech: 'DOMParser API → DOM 트리 순회 → IR → HWPX',
        features: [
            'h1~h6, p, table, ul, ol, strong, em 등 주요 태그 지원',
            '중첩 구조(리스트·표) 처리',
        ],
        limits: ['CSS 레이아웃·색상 대부분 무시', '이미지·SVG 미지원', 'script·style 태그 무시'],
    },
    docx: {
        icon: '📘', name: 'Word 문서 (DOCX)',
        quality: '★☆☆', available: true,
        desc: 'Microsoft Word의 Office Open XML(.docx) 형식입니다.',
        tech: 'JSZip으로 압축 해제 → word/document.xml 본문·표 추출 → IR → HWPX',
        features: [
            '본문 텍스트와 기본 제목 스타일 추출',
            '단순 표(Table) 구조 변환',
            '일부 목록 텍스트 추출',
        ],
        limits: ['이미지 미지원', '머리글·바닥글 미지원', '각주·미주 미지원', '정렬·색상·폰트·병합 셀 등 복잡한 서식 손실'],
    },
    hwp: {
        icon: '🇰🇷', name: '한글 문서 (HWP)',
        quality: '★☆☆', available: true, badge: '베타',
        desc: '한컴 오피스 한글 파일입니다. HWP(바이너리)와 HWPX(XML) 두 종류가 있습니다.',
        tech: 'ZIP 구조 시도 → 내부 XML/텍스트 추출 → IR',
        features: ['HWPX 파일: 내부 XML 직접 파싱으로 본문 텍스트 추출'],
        limits: ['HWP5(바이너리) 형식은 파싱이 대폭 제한됨', '서식·이미지·표 복원 불완전'],
        tip: {
            title: '💡 한글에서 HWPX로 직접 저장하는 더 쉬운 방법',
            steps: [
                '한글 프로그램에서 파일을 엽니다',
                '[파일] → [다른 이름으로 저장] 선택 (단축키: alt + v)',
                '"파일 형식" 드롭다운에서 HWPX(*.hwpx) 선택',
                '저장하면 완료됩니다. 이 사이트에 업로드할 필요 없이 바로 사용할 수 있습니다.',
            ],
        },
    },
    txt: {
        icon: '📄', name: '일반 텍스트 (TXT)',
        quality: '★★★', available: true,
        desc: '서식 없는 순수 텍스트 파일입니다.',
        tech: '줄바꿈 패턴 분석 → 문단 구분 → IR → HWPX',
        features: [
            '빈 줄로 문단 자동 구분',
            'UTF-8 / EUC-KR 인코딩 자동 감지',
            '이모지 지원',
        ],
        limits: ['서식 정보 없음 (모두 일반 문단으로 처리)'],
    },
    csv: {
        icon: '📊', name: 'CSV / XLSX 스프레드시트',
        quality: '★★☆', available: true,
        desc: '쉼표 구분 데이터(CSV) 또는 Excel 스프레드시트(XLSX)입니다.',
        tech: 'CSV: RFC 4180 파서 / XLSX: SheetJS 라이브러리 → 표 IR → HWPX',
        features: [
            'CSV 전체 데이터 또는 XLSX 첫 번째 시트를 한글 표로 변환',
            '첫 행을 표 헤더(진한 배경)로 자동 처리',
            '텍스트/숫자 셀에 맞춘 기본 정렬 적용',
            '한글·특수문자 완전 지원',
        ],
        limits: ['XLSX는 첫 번째 시트만 변환', '셀 병합·색상·폰트·테두리 무시', '수식은 결과값만 변환'],
    },
    json: {
        icon: '{ }', name: 'JSON 데이터',
        quality: '★★★', available: true,
        desc: 'JavaScript 객체 표기법 데이터 파일입니다.',
        tech: 'JSON.parse → 구조 분석 → IR → HWPX (IR 형식이면 직접 사용)',
        features: [
            '배열 → 표(Table)로 변환',
            '중첩 객체 → 들여쓰기 목록으로 변환',
            'IR 형식 JSON을 직접 HWPX로 변환 가능 (고급 사용)',
        ],
        limits: ['매우 큰 JSON(10MB+)은 처리 시간 증가'],
    },
    ipynb: {
        icon: '🔬', name: 'Jupyter Notebook (IPYNB)',
        quality: '★★☆', available: true,
        desc: 'Python 등 데이터 과학에 쓰이는 노트북 파일 형식입니다.',
        tech: 'JSON 파싱 → cell_type별 처리(markdown/code/output) → IR → HWPX',
        features: [
            '마크다운 셀: 제목·표·코드블록 변환',
            '코드 셀: 등폭 코드블록으로 변환',
            '텍스트 출력 셀: 그대로 포함',
        ],
        limits: ['이미지 출력 셀(PNG/JPEG) 미지원', 'LaTeX 수식 미지원'],
    },
    pdf: {
        icon: '📕', name: 'PDF 문서',
        quality: '★★☆', available: false, badge: '예정',
        desc: '레이아웃 고정 문서 형식입니다. 클라이언트 단독 처리가 어렵습니다.',
        tech: '백엔드 PDF 파싱 서비스 연동 예정',
        features: ['텍스트 추출 후 변환 예정'],
        limits: ['레이아웃 복원 불가', '이미지·표 추출 제한', '스캔 PDF 미지원'],
    },
    pptx: {
        icon: '📑', name: 'PowerPoint (PPTX)',
        quality: '★☆☆', available: false, badge: '예정',
        desc: 'Microsoft PowerPoint 슬라이드 파일입니다.',
        tech: 'OOXML 파싱 → 슬라이드 텍스트 추출 예정',
        features: ['슬라이드별 텍스트 추출 예정'],
        limits: ['슬라이드 레이아웃·디자인 재현 불가', '이미지 미지원'],
    },
    odt: {
        icon: '📃', name: 'ODT / RTF 오픈 문서',
        quality: '★★☆', available: false, badge: '예정',
        desc: 'OpenDocument Text(ODT) 및 Rich Text Format(RTF)입니다.',
        tech: 'XML/바이너리 파싱 예정',
        features: ['기본 텍스트·표 변환 예정'],
        limits: ['복잡한 구조 파싱 난이도 높음'],
    },
    epub: {
        icon: '📚', name: '전자책 (EPUB)',
        quality: '★★☆', available: false, badge: '예정',
        desc: 'EPUB3 전자책 형식으로, ZIP + HTML 내부 구조입니다.',
        tech: 'JSZip → EPUB 내부 HTML 파싱 예정',
        features: ['챕터별 텍스트 추출 예정', '목차 보존 예정'],
        limits: ['이미지·폰트 무시', 'EPUB2/3 호환성 필요'],
    },
};

const FONT_DOWNLOADS = [
    {
        name: 'Noto Sans KR',
        family: 'Noto Sans KR',
        systemNames: ['Noto Sans KR', 'NotoSansKR', 'Noto Sans KR Regular'],
        desc: 'Google/Adobe 계열의 넓은 문자 지원 고딕체입니다. 웹 UI 미리보기와 일반 문서용으로 무난합니다.',
        local: ['fonts/NotoSansKR-Regular.ttf', 'Font/NotoSansKR-Regular.ttf', 'Font/Noto_Sans_KR/NotoSansKR-Regular.ttf'],
        official: 'https://fonts.google.com/selection?preview.script=Kore&preview.lang=ko_Kore',
    },
    {
        name: '나눔고딕',
        family: 'NanumGothic',
        systemNames: [
            '나눔고딕', '나눔고딕 보통', '나눔고딕 Regular', '나눔고딕OTF', '나눔고딕OTF Regular',
            'NanumGothic', 'NanumGothic Regular', 'NanumGothicOTF', 'NanumGothicOTF Regular',
            'Nanum Gothic', 'Nanum Gothic Regular', 'Nanum Gothic OTF', 'Nanum Gothic OTF Regular'
        ],
        desc: '네이버 배포 한글 고딕체입니다. 국내 사용자에게 익숙하고 일반 문서에 잘 맞습니다.',
        local: ['fonts/NanumGothic.ttf', 'Font/NanumGothic.ttf', 'Font/NanumGothic/NanumGothic.ttf'],
        official: 'https://hangeul.naver.com/font',
    },
    {
        name: 'KoPub돋움체',
        family: 'KoPub돋움체',
        systemNames: ['KoPub돋움체', 'KoPub돋움체 Medium', 'KoPub World Dotum Medium', 'KoPubWorldDotum Medium', 'KoPubDotumMedium'],
        desc: '한국출판인회의 배포 공공 라이선스 돋움체입니다. 출판·공공 문서에 잘 어울리며 무료로 사용할 수 있습니다.',
        local: ['fonts/KoPubWorldDotum-Medium.ttf', 'Font/KoPubDotumMedium.ttf', 'Font/kopub/KoPubDotumMedium.ttf'],
        official: 'https://www.kopus.org/biz-electronic-font2/',
    },
    {
        name: 'Pretendard GOV',
        family: 'Pretendard',
        systemNames: ['Pretendard GOV', 'Pretendard', 'Pretendard 보통', 'PretendardGOV-Regular'],
        desc: '오픈소스로 공개된 공공 라이선스 현대 고딕체입니다. 디지털 행정 문서에 잘 어울립니다.',
        local: ['fonts/PretendardGOV-Regular.ttf', 'Font/Pretendard-Regular.ttf', 'Font/Pretendard GOV-1.3.9/Pretendard-Regular.ttf'],
        official: 'https://github.com/orioncactus/pretendard/releases/tag/v1.3.9',
    },
];

/** 포맷 카드 클릭 → 상세 정보 팝업 표시 */
function initFormatCards() {
    document.querySelectorAll('.format-card').forEach(card => {
        decorateFormatCard(card);
        card.addEventListener('click', () => {
            const ext = card.dataset.ext || '';
            if (ext) openFormatModal(ext);
        });
    });

    document.getElementById('close-format-modal')
        ?.addEventListener('click', closeFormatModal);
    document.getElementById('format-modal')
        ?.addEventListener('click', e => {
            if (e.target.id === 'format-modal') closeFormatModal();
        });
    document.getElementById('fmt-modal-use-btn')
        ?.addEventListener('click', () => {
            const ext = document.getElementById('fmt-modal-use-btn').dataset.ext || '';
            closeFormatModal();
            updateFormatExpectation(ext, true);
            document.getElementById('converter')?.scrollIntoView({ behavior: 'smooth' });
        });
}

function decorateFormatCard(card) {
    const ext = card.dataset.ext || '';
    const info = getFormatInfoForExt(ext);
    if (!info) return;
    const summary = getConversionSummaryForExt(ext);
    const badge = card.querySelector('.card-badge');
    if (badge && info.available && !info.badge) badge.textContent = '입력 가능';
    const qualityEl = card.querySelector('.card-quality');
    if (qualityEl) {
        qualityEl.innerHTML = `
            <span class="card-quality-stars">${escHtml(info.quality || '')}</span>
            <span class="card-quality-label">${escHtml(qualityText(info.quality))}</span>
        `;
    }
    if (!card.querySelector('.card-loss-preview')) {
        const preview = document.createElement('div');
        preview.className = 'card-loss-preview';
        preview.textContent = `제외 가능: ${summary.lossy}`;
        card.appendChild(preview);
    }
}

function openFormatModal(ext) {
    const info = FORMAT_INFO[ext];
    if (!info) return;
    const modal = document.getElementById('format-modal');
    if (!modal) return;

    document.getElementById('fmt-modal-title').textContent = `${info.icon} ${info.name}`;

    const badgeClass = info.available ? (info.badge ? 'badge-beta' : 'badge-available') : 'badge-soon';
    const badgeLabel = info.badge || '지원됨';

    let html = `<div class="fmt-modal-quality">`;
    html    += `<span class="fmt-quality-stars">${info.quality}</span>`;
    html    += `<span class="card-badge ${badgeClass}">${badgeLabel}</span>`;
    html    += `</div>`;
    html    += `<p class="fmt-modal-desc">${info.desc}</p>`;
    html    += `<div class="fmt-modal-section"><h4>변환 방식</h4>`;
    html    += `<p class="fmt-tech">${info.tech}</p></div>`;

    if (info.features?.length) {
        html += `<div class="fmt-modal-section"><h4>지원 기능</h4><ul>`;
        info.features.forEach(f => { html += `<li>${f}</li>`; });
        html += `</ul></div>`;
    }
    if (info.limits?.length) {
        html += `<div class="fmt-modal-section"><h4>제한사항</h4><ul class="fmt-limits">`;
        info.limits.forEach(l => { html += `<li>${l}</li>`; });
        html += `</ul></div>`;
    }
    if (info.tip) {
        html += `<div class="fmt-modal-tip"><strong>${info.tip.title}</strong><ol>`;
        info.tip.steps.forEach(s => { html += `<li>${s}</li>`; });
        html += `</ol></div>`;
    }

    document.getElementById('fmt-modal-body').innerHTML = html;

    const footer = document.getElementById('fmt-modal-footer');
    if (footer) footer.hidden = !info.available;
    const useBtn = document.getElementById('fmt-modal-use-btn');
    if (useBtn) useBtn.dataset.ext = ext;

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeFormatModal() {
    document.getElementById('format-modal')?.classList.remove('open');
    document.body.style.overflow = '';
}

async function hasLocalFont(path) {
    try {
        const res = await fetch(path, { method: 'HEAD', cache: 'no-store' });
        return res.ok;
    } catch (_) {
        return false;
    }
}

async function findLocalFont(paths) {
    for (const path of paths) {
        if (await hasLocalFont(path)) return path;
    }
    return '';
}

async function loadBundledFontForPreview(font) {
    if (!('FontFace' in window) || !font?.family || !font?.local?.length) return false;
    for (const path of font.local) {
        try {
            const res = await fetch(path, { cache: 'no-store' });
            if (!res.ok) continue;
            const buffer = await res.arrayBuffer();
            const face = new FontFace(font.family, buffer);
            await face.load();
            document.fonts.add(face);
            return true;
        } catch (_) {}
    }
    return false;
}

/**
 * 캔버스 텍스트 폭 비교로 시스템 폰트 설치 여부 감지.
 * 권한(queryLocalFonts)·CDN 불필요, 전 브라우저 동작. 대상 폰트로 렌더한 폭이
 * 일반 대체글꼴(monospace/serif/sans-serif)과 다르면 그 폰트가 설치된 것으로 판단.
 * 한글·라틴·한자를 섞은 표본을 써서 한글 전용 글꼴도 안정적으로 구분한다.
 */
function isFontInstalledByMeasure(name) {
    try {
        if (!isFontInstalledByMeasure._ctx) {
            isFontInstalledByMeasure._ctx = document.createElement('canvas').getContext('2d');
        }
        const ctx = isFontInstalledByMeasure._ctx;
        if (!ctx) return false;
        const sample = '한글ABCmwWil漢字가나다라微嶺';
        const widthOf = family => { ctx.font = `72px ${family}`; return ctx.measureText(sample).width; };
        // 3개 대체글꼴 중 하나라도 폭이 달라지면 설치된 것 (기본 한글 글꼴과 겹치는 경우 대비)
        return ['monospace', 'serif', 'sans-serif'].some(base => widthOf(`"${name}", ${base}`) !== widthOf(base));
    } catch (_) { return false; }
}

function isFontInstalledByPixels(name) {
    try {
        if (!isFontInstalledByPixels._canvas) {
            isFontInstalledByPixels._canvas = document.createElement('canvas');
            isFontInstalledByPixels._canvas.width = 360;
            isFontInstalledByPixels._canvas.height = 96;
            isFontInstalledByPixels._ctx = isFontInstalledByPixels._canvas.getContext('2d', { willReadFrequently: true });
        }
        const canvas = isFontInstalledByPixels._canvas;
        const ctx = isFontInstalledByPixels._ctx;
        if (!canvas || !ctx) return false;
        const sample = '가나다라마바사 ABCD 1234';
        const signature = family => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#000';
            ctx.font = `48px ${family}`;
            ctx.textBaseline = 'top';
            ctx.fillText(sample, 8, 8);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let hash = 0;
            let ink = 0;
            for (let i = 3; i < data.length; i += 16) {
                const alpha = data[i];
                if (alpha) ink += alpha;
                hash = ((hash << 5) - hash + alpha) | 0;
            }
            return `${ink}:${hash}`;
        };
        return ['monospace', 'serif', 'sans-serif'].some(base => {
            const fallback = signature(base);
            const candidate = signature(`"${name}", ${base}`);
            return candidate !== fallback;
        });
    } catch (_) { return false; }
}

async function isSystemFontInstalled(names, localFontsList = null) {
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
    // 1) queryLocalFonts() — 현재 사용자 설치 폰트까지 (공백·대소문자 정규화 + 굵기 접미사 보완)
    if (localFontsList !== null) {
        const pool = [];
        for (const f of localFontsList) pool.push(norm(f.family), norm(f.fullName), norm(f.postscriptName));
        const exact = new Set(pool);
        if (names.some(n => exact.has(norm(n)))) return true;
        // "NanumGothic" 조회 시 "NanumGothicBold" 등 굵기 변형도 설치로 인정 (접두 4자 이상)
        if (names.some(n => { const k = norm(n); return k.length >= 4 && pool.some(p => p && p.startsWith(k)); })) return true;
    }
    // 2) 캔버스 폭 측정 — 권한 없이도 동작하는 신뢰성 높은 방법 (나눔고딕 미인식 문제 해결)
    if (names.some(isFontInstalledByMeasure)) return true;
    if (names.some(isFontInstalledByPixels)) return true;
    // 3) 폴백: FontFace local()
    for (const name of names) {
        try {
            const font = new FontFace('__detect__', `local("${name}")`);
            await font.load();
            return true;
        } catch (_) {}
    }
    return false;
}

function formatFontDescription(desc) {
    const splitAt = desc.indexOf('. ');
    if (splitAt === -1) return escHtml(desc);
    const firstSentence = desc.slice(0, splitAt + 1);
    const rest = desc.slice(splitAt + 2);
    return `${escHtml(firstSentence)}<br>${escHtml(rest)}`;
}

async function renderFontGuide() {
    const el = document.getElementById('font-guide-list');
    if (!el) return;

    el.innerHTML = FONT_DOWNLOADS.map((font, index) => `
        <section class="font-guide-item">
            <div>
                <h3>${escHtml(font.name)}</h3>
                <p>${formatFontDescription(font.desc)}</p>
                <p class="font-guide-sample" style="font-family:'${escHtml(font.family || font.name)}', var(--font-main)">문서를 한글(HWPX)로 변환합니다 123</p>
            </div>
            <div class="font-guide-actions" data-font-index="${index}">
                <span class="font-guide-local-missing">확인 중...</span>
                <a class="font-official-link" href="${escHtml(font.official)}" target="_blank" rel="noopener">공식 사이트</a>
            </div>
        </section>
    `).join('');

    // queryLocalFonts() 한 번만 호출 — 현재 사용자 설치 폰트 포함, 권한 허용 시
    let localFontsList = null;
    if ('queryLocalFonts' in window) {
        try { localFontsList = await window.queryLocalFonts(); } catch (_) {}
    }

    await Promise.all(FONT_DOWNLOADS.map(async (font, i) => {
        const box = el.querySelector(`[data-font-index="${i}"]`);
        if (!box) return;
        const [isInstalled, localPath] = await Promise.all([
            isSystemFontInstalled(font.systemNames || [font.name], localFontsList),
            findLocalFont(font.local),
        ]);
        const isBundledUsable = !isInstalled && font.name === '나눔고딕'
            ? await loadBundledFontForPreview(font)
            : false;
        const official = `<a class="font-official-link" href="${escHtml(font.official)}" target="_blank" rel="noopener">공식 사이트</a>`;
        if (isInstalled) {
            box.innerHTML = `<span class="font-installed-badge">설치됨 ✓</span>${official}`;
        } else if (isBundledUsable) {
            box.innerHTML = `<span class="font-installed-badge">사용 가능 ✓</span>${official}`;
        } else if (localPath) {
            box.innerHTML = `<a href="${escHtml(localPath)}" download>TTF 다운로드</a>${official}`;
        } else {
            box.innerHTML = `<span class="font-guide-local-missing">미설치</span>${official}`;
        }
    }));
}

function showFontGuide() {
    const modal = document.getElementById('font-guide-modal');
    if (!modal) return;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderFontGuide();
}

function closeFontGuide() {
    document.getElementById('font-guide-modal')?.classList.remove('open');
    document.body.style.overflow = '';
}


// ─────────────────────────────────────────────────────────────────────────
// [옵션 패널]
//   문서 유형(공문/보고서/일반) + 사용자 지정 제목 + IR 미리보기 토글
// ─────────────────────────────────────────────────────────────────────────
function initOptions() {
    // 문서 유형 선택 (<select>)
    const docTypeEl = document.getElementById('doc-type');
    if (docTypeEl) {
        docTypeEl.addEventListener('change', () => {
            state.docType = docTypeEl.value;
        });
    }

    // 사용자 지정 제목 입력
    const titleEl = document.getElementById('doc-title');
    if (titleEl) {
        titleEl.addEventListener('input', () => {
            state.customTitle = titleEl.value.trim();
        });
    }

    // 폰트 선택 (<select id="doc-font">) — 선택 값 localStorage 저장
    const fontEl = document.getElementById('doc-font');
    if (fontEl) {
        const savedFont = localStorage.getItem('tohwpx_font');
        if (savedFont) {
            const valid = Array.from(fontEl.options).some(o => o.value === savedFont);
            if (valid) { fontEl.value = savedFont; state.docFont = savedFont; }
        }
        fontEl.addEventListener('change', () => {
            state.docFont = fontEl.value;
            localStorage.setItem('tohwpx_font', fontEl.value);
        });
    }

    // 글꼴 크기 (<select id="font-size">) — 선택 값 localStorage 저장
    const fontSizeEl = document.getElementById('font-size');
    if (fontSizeEl) {
        const savedSize = localStorage.getItem('tohwpx_fontSize');
        if (savedSize) {
            const v = parseInt(savedSize, 10);
            if (!isNaN(v) && v >= 6 && v <= 36) {
                fontSizeEl.value = String(v);
                state.fontSize = v;
            }
        }
        fontSizeEl.addEventListener('change', () => {
            const v = parseInt(fontSizeEl.value, 10);
            if (!isNaN(v) && v >= 6 && v <= 36) {
                state.fontSize = v;
                localStorage.setItem('tohwpx_fontSize', String(v));
            }
        });
    }

    // 용지 크기 선택 (<select id="paper-size">) — 선택 값 localStorage 저장
    const paperEl = document.getElementById('paper-size');
    if (paperEl) {
        const savedPaper = localStorage.getItem('tohwpx_paperSize');
        if (savedPaper) {
            const valid = Array.from(paperEl.options).some(o => o.value === savedPaper);
            if (valid) { paperEl.value = savedPaper; state.paperSize = savedPaper; }
        }
        paperEl.addEventListener('change', () => {
            state.paperSize = paperEl.value;
            localStorage.setItem('tohwpx_paperSize', paperEl.value);
        });
    }

    // 용지 방향 버튼 (#paper-orient)
    const orientBtn = document.getElementById('paper-orient');
    if (orientBtn) {
        const savedOrient = localStorage.getItem('tohwpx_orientation');
        if (savedOrient === 'landscape') {
            state.orientation = 'landscape';
            applyOrientationUi('landscape');
        }
        orientBtn.addEventListener('click', () => {
            const toLandscape = state.orientation === 'portrait';
            state.orientation = toLandscape ? 'landscape' : 'portrait';
            applyOrientationUi(state.orientation);
            localStorage.setItem('tohwpx_orientation', state.orientation);
        });
    }

    // 페이지 여백 입력 (mm 단위, #margin-top/bottom/left/right/header/footer)
    const marginIds = ['top', 'bottom', 'left', 'right', 'header', 'footer'];
    marginIds.forEach(side => {
        const el = document.getElementById(`margin-${side}`);
        if (!el) return;
        const syncMargin = () => {
            const val = parseFloat(el.value);
            if (isNaN(val)) {
                el.value = state.pageMargins[side];
                return;
            }
            const max = (side === 'header' || side === 'footer') ? 30 : 60;
            state.pageMargins[side] = Math.max(0, Math.min(max, val));
            el.value = state.pageMargins[side];
        };
        el.addEventListener('change', syncMargin);
        el.addEventListener('input', () => {
            const val = parseFloat(el.value);
            if (!isNaN(val)) state.pageMargins[side] = val;
        });
    });

    const autoDownloadEl = document.getElementById('auto-download');
    if (autoDownloadEl) {
        const savedAuto = localStorage.getItem('tohwpx_autoDownload');
        if (savedAuto !== null) {
            autoDownloadEl.checked = savedAuto !== 'false';
            state.autoDownload = autoDownloadEl.checked;
        } else {
            state.autoDownload = autoDownloadEl.checked;
        }
        autoDownloadEl.addEventListener('change', () => {
            state.autoDownload = autoDownloadEl.checked;
            localStorage.setItem('tohwpx_autoDownload', String(autoDownloadEl.checked));
        });
    }

    // IR 미리보기 접기/펼치기 버튼
    const irToggle  = document.getElementById('ir-toggle');
    const irPreview = document.getElementById('ir-preview');
    if (irToggle && irPreview) {
        irToggle.addEventListener('click', () => {
            const isHidden = irPreview.hidden;
            irPreview.hidden = !isHidden;
            irToggle.textContent = isHidden ? '▼ IR 미리보기 숨기기' : '▶ IR 미리보기 보기';
            irToggle.setAttribute('aria-expanded', String(isHidden));
        });
    }
}


// ─────────────────────────────────────────────────────────────────────────
// [변환 버튼 + Ctrl+Enter 단축키]
// ─────────────────────────────────────────────────────────────────────────
function initConvertButton() {
    const btn = document.getElementById('convert-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (!state.file || state.isConverting) return;
        syncMarginInputs();
        runConversionPipeline();
    });

    // Ctrl+Enter (Windows/Linux) / ⌘+Enter (Mac) 단축키로 변환 시작
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            if (state.file && !state.isConverting) {
                e.preventDefault();
                syncMarginInputs();
                runConversionPipeline();
            }
        }
    });
}

/** 변환 버튼 활성/비활성 상태 및 텍스트 변경 */
function updateConvertButton(enabled) {
    const btn = document.getElementById('convert-btn');
    if (!btn) return;
    btn.disabled   = !enabled;
    btn.textContent = enabled ? '변환 시작 →' : '파일을 먼저 선택하세요';
}


// ─────────────────────────────────────────────────────────────────────────
// [핵심: 7단계 변환 파이프라인 실행]
//   비동기(async) 함수 — 각 단계가 순차적으로 실행되며 UI에 진행 상태 표시
// ─────────────────────────────────────────────────────────────────────────
async function runConversionPipeline() {
    if (!state.file || state.isConverting) return;

    state.isConverting = true;
    resetPipeline();
    setProgressPanelState('converting');
    hideResult();
    hideAlert();
    updateConvertButton(false);

    // 변환 시작 시 진행 패널이 보이도록 스크롤
    const progressPanel = document.querySelector('.progress-panel');
    if (progressPanel) {
        progressPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    try {
        // ═══ 1단계: Ingest (파일 읽기 준비) ═══
        setStepState('ingest', 'active');
        setProgress(8);
        await tick();  // UI 업데이트를 위한 이벤트 루프 양보
        setStepState('ingest', 'done');

        // ═══ 2단계: Normalize (포맷 파서로 IR 변환) ═══
        setStepState('normalize', 'active');
        setProgress(25);
        setStatusText('파일을 분석하는 중...');

        let ir;
        try {
            // parsers.js의 fileToIR() 호출 (포맷 자동 감지 + 변환)
            ir = await fileToIR(state.file, state.docType);
        } catch (e) {
            throw new Error('파일 파싱 실패: ' + e.message);
        }

        // 사용자가 제목을 직접 입력했으면 파서 감지 제목을 덮어씀
        if (state.customTitle) ir.title = state.customTitle;
        state.ir = ir;

        // [보안] IR 미리보기는 textContent로만 표시 (innerHTML 사용 금지)
        updateIrPreview(ir);
        setStepState('normalize', 'done');
        setProgress(42);

        // ═══ 3단계: Generate (HWPX 생성) ═══
        setStepState('generate', 'active');
        setProgress(58);
        setStatusText('HWPX 파일을 생성하는 중...');
        await tick();

        let hwpxBlob;
        try {
            // hwpx.js의 buildHwpx() 호출 (폰트·크기·여백·용지 전달)
            hwpxBlob = await buildHwpx(ir, state.docFont, state.fontSize, state.pageMargins, state.paperSize, (pct) => {
                 setProgress(58 + (pct * 0.14)); // 58% ~ 72%
                 setStatusText(`HWPX 파일을 압축하는 중... ${Math.round(pct)}%`);
            }, state.orientation);
        } catch (e) {
            throw new Error('HWPX 생성 실패: ' + e.message);
        }
        setStepState('generate', 'done');

        // ═══ 4단계: Validate (4영역 구조 검증) ═══
        setStepState('validate', 'active');
        setProgress(72);
        setStatusText('HWPX 구조를 검증하는 중...');

        let validation;
        try {
            // hwpx.js의 validateHwpx() 호출
            validation = await validateHwpx(hwpxBlob, state.pageMargins);
        } catch (e) {
            validation = { pass: false, issues: ['검증 실행 오류: ' + e.message] };
        }
        setStepState('validate', validation.pass ? 'done' : 'error');
        setProgress(82);

        // ═══ 5단계: Preview (미리보기 준비) ═══
        setStepState('preview', 'active');
        setProgress(88);
        await tick();
        // [한계] 브라우저에서 HWPX를 직접 렌더링할 수 없음
        //        IR 미리보기(JSON)만 제공하는 것으로 대체
        setStepState('preview', 'done');

        // ═══ 6단계: Repair (자동 수정) ═══
        setStepState('repair', 'active');
        setProgress(93);

        const finalBlob = ensureHwpxBlob(hwpxBlob);  // 모바일 브라우저가 ZIP로 추론하지 않도록 MIME 고정
        state.hwpxBlob = finalBlob;  // 미리보기 버튼에서 참조
        setStepState('repair', 'done');

        // ═══ 7단계: Ship (다운로드 준비) ═══
        setStepState('ship', 'active');
        setProgress(98);
        setStatusText('다운로드를 준비하는 중...');
        await tick();

        // 출력 파일명: 원본 확장자를 .hwpx로 교체
        const baseName = state.file.name.replace(/\.[^.]+$/, '');
        const fileName = `${baseName}.hwpx`;

        // [보안] Blob URL 생성 → 5분 후 자동 해제 (메모리 누수 및 개인정보 보호)
        revokeDownloadUrl();
        const downloadUrl = URL.createObjectURL(finalBlob);
        state.downloadUrl = downloadUrl;
        state.downloadTimer = setTimeout(revokeDownloadUrl, 300_000);

        setStepState('ship', 'done');
        setProgress(100);
        setStatusText('완료!');

        // 결과 카드 표시
        showResult({ url: downloadUrl, fileName, size: finalBlob.size, validation });
        setProgressPanelState(validation.pass ? 'success' : 'warning');
        if (state.autoDownload) {
            triggerDownload(downloadUrl, fileName);
            setStatusText('완료! 다운로드를 시작했습니다.');
        }

    } catch (err) {
        setProgressPanelState('error');
        setStatusText('실패');
        showFailureResult(err);
        const failure = classifyConversionError(err);
        showAlert(`${failure.title}\n다음 행동: ${failure.action}`);
        console.error('[To HWPX] 변환 오류:', err);
    } finally {
        state.isConverting = false;
        updateConvertButton(!!state.file);
    }
}


// ─────────────────────────────────────────────────────────────────────────
// [IR 미리보기]
//   변환된 IR JSON을 코드 블록에 표시
//   [보안] 반드시 textContent 사용 (innerHTML 절대 금지)
// ─────────────────────────────────────────────────────────────────────────
function updateIrPreview(ir) {
    const el = document.getElementById('ir-content');
    if (!el) return;
    // textContent는 HTML 파싱 없이 텍스트로만 처리 → XSS 불가
    el.textContent = JSON.stringify(ir, null, 2);
}


// ─────────────────────────────────────────────────────────────────────────
// [결과 표시 + 다운로드]
// ─────────────────────────────────────────────────────────────────────────

/** 변환 결과 카드 표시 */
function showResult({ url, fileName, size, validation }) {
    const area = document.getElementById('result-area');
    if (!area) return;
    const ext = state.file ? getFileExtension(state.file.name) : '';
    const inputLabel = getInputFormatLabel(ext);
    const summary = getConversionSummary();
    const issues = Array.isArray(validation.issues) ? validation.issues : [];
    const issuePreview = issues.slice(0, 3);
    const officeCheck = validation.pass
        ? '권장 — 미리보기와 한컴오피스의 글꼴·여백·표 너비가 다를 수 있습니다.'
        : '필수 — 구조 검증 경고가 있어 한컴오피스에서 반드시 열어 확인하세요.';

    // 검증 결과에 따른 표시 텍스트
    const validText = validation.pass
        ? '✓ 주요 구조 검증 PASS — 한글 호환 패키지 조건 충족'
        : `⚠ 구조 검증 경고 ${issues.length || 1}건 — 다운로드 전 미리보기를 확인하세요`;
    const validClass = validation.pass ? 'result-valid' : 'result-warn';
    const cardClass = validation.pass ? '' : ' result-card--warn';
    const autoText = state.autoDownload
        ? '자동 다운로드가 시작되었습니다. 필요하면 다시 다운로드하거나 미리보기를 여세요.'
        : '자동 다운로드가 꺼져 있습니다. 아래 버튼으로 내려받으세요.';

    // [보안] URL은 blob: 스킴만 가능 (직접 생성했으므로 안전)
    //         escHtml()로 fileName을 이스케이프하여 XSS 방지
    area.innerHTML = `
        <div class="result-card${cardClass}">
            <div class="result-primary">
                <div class="result-file-row">
                    <span class="result-file-icon">📄</span>
                    <div class="result-file-info">
                        <strong>${escHtml(fileName)}</strong>
                        <span class="result-file-size">${formatBytes(size)} · 입력 ${escHtml(inputLabel)}</span>
                    </div>
                </div>
                <a id="download-link"
                   href="${url}"
                   download="${escHtml(fileName)}"
                   type="application/hwp+zip"
                   class="btn-download btn-download-primary">
                    ⬇ HWPX 다운로드
                </a>
            </div>
            <div class="result-validation ${validClass}">
                ${escHtml(validText)}
            </div>
            <div class="result-trust-list" aria-label="산출물 신뢰도 요약">
                <span class="${validation.pass ? 'trust-ok' : 'trust-warn'}">${validation.pass ? '패키지 구조 통과' : '구조 확인 필요'}</span>
                <span class="trust-ok">브라우저 내부 처리</span>
                <span class="trust-info">다운로드 링크 5분 유지</span>
                <span class="trust-info">최종 서식은 한컴에서 확인</span>
            </div>
            ${issuePreview.length ? `
                <ul class="result-issues">
                    ${issuePreview.map(issue => `<li>${escHtml(issue)}</li>`).join('')}
                    ${issues.length > issuePreview.length ? `<li>외 ${issues.length - issuePreview.length}건</li>` : ''}
                </ul>
            ` : ''}
            <div class="result-summary">
                <p><strong>변환된 파일명</strong> ${escHtml(fileName)}</p>
                <p><strong>입력 포맷</strong> ${escHtml(inputLabel)}</p>
                <p><strong>보존된 요소</strong> ${escHtml(summary.preserved)}</p>
                <p><strong>제외/손실된 요소</strong> ${escHtml(summary.lossy)}</p>
                <p><strong>한컴오피스 확인</strong> ${escHtml(officeCheck)}</p>
            </div>
            <div class="result-actions">
                <button class="btn-preview" id="preview-result-btn">
                    👁 미리보기
                </button>
            </div>
            <p class="result-note">${escHtml(autoText)} 다운로드 링크는 5분 후 만료됩니다.</p>
        </div>
    `;
    area.style.display = 'block';
    area.querySelector('#download-link')?.addEventListener('click', () => {
        const validationEl = area.querySelector('.result-validation');
        if (validationEl && !validationEl.textContent.includes('다운로드됨')) {
            validationEl.textContent += ' (다운로드됨)';
        }
        // 수동 다운로드 클릭 시에도 인디케이터 표시
        const ind = document.getElementById('dl-indicator');
        if (ind) {
            ind.hidden = false;
            setTimeout(() => { ind.hidden = true; }, 2800);
        }
    });
    area.querySelector('#preview-result-btn')?.addEventListener('click', () => openPreview(state.hwpxBlob));
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showFailureResult(err) {
    const area = document.getElementById('result-area');
    if (!area) return;
    const failure = classifyConversionError(err);
    const ext = state.file ? getFileExtension(state.file.name) : '';
    const inputLabel = ext ? getInputFormatLabel(ext) : '선택한 파일';
    area.innerHTML = `
        <div class="result-card result-card--error">
            <div class="failure-head">
                <strong>${escHtml(failure.title)}</strong>
                <span>${escHtml(failure.category)}</span>
            </div>
            <div class="result-summary">
                <p><strong>입력 포맷</strong> ${escHtml(inputLabel)}</p>
                <p><strong>원인</strong> ${escHtml(failure.reason)}</p>
                <p><strong>다음 행동</strong> ${escHtml(failure.action)}</p>
            </div>
        </div>
    `;
    area.style.display = 'block';
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function classifyConversionError(err) {
    const msg = String(err?.message || err || '');
    if (/지원하지 않는|unsupported|확장자|format/i.test(msg)) {
        return {
            category: '지원하지 않는 포맷',
            title: '이 파일 형식은 바로 변환할 수 없습니다.',
            reason: msg,
            action: `입력 가능 포맷(${SUPPORTED_FORMAT_LABEL})으로 저장한 뒤 다시 선택하세요.`,
        };
    }
    if (/크기 초과|too large|50MB|100MB|용량|size/i.test(msg)) {
        return {
            category: '파일 크기',
            title: '파일이 브라우저에서 처리하기에 너무 큽니다.',
            reason: msg,
            action: '문서를 나누거나 이미지·불필요한 시트를 줄인 뒤 다시 변환하세요.',
        };
    }
    if (/파싱|parse|JSON|ZIP|로드 실패|손상|압축/i.test(msg)) {
        return {
            category: '파싱 오류',
            title: '파일 내용을 읽는 중 문제가 생겼습니다.',
            reason: msg,
            action: '원본 프로그램에서 파일을 다시 저장하거나, DOCX/HWPX처럼 표준 형식으로 내보낸 뒤 다시 시도하세요.',
        };
    }
    if (/HWP5|바이너리|구조|검증|미지원|unsupported structure/i.test(msg)) {
        return {
            category: '지원하지 않는 구조',
            title: '파일 안의 일부 구조를 변환할 수 없습니다.',
            reason: msg,
            action: '한컴오피스에서 HWPX 또는 DOCX로 다시 저장한 뒤 변환하세요.',
        };
    }
    if (/download|다운로드|차단|blocked|not allowed/i.test(msg)) {
        return {
            category: '브라우저 다운로드 차단',
            title: '브라우저가 자동 다운로드를 막았습니다.',
            reason: msg,
            action: '완료 카드의 HWPX 다운로드 버튼을 직접 누르거나 브라우저 다운로드 허용 설정을 확인하세요.',
        };
    }
    return {
        category: '변환 처리',
        title: '변환을 완료하지 못했습니다.',
        reason: msg || '알 수 없는 오류가 발생했습니다.',
        action: '파일을 다시 저장한 뒤 재시도하고, 계속 실패하면 더 단순한 입력 포맷(TXT, MD, DOCX)으로 변환해 보세요.',
    };
}

function getInputFormatLabel(ext) {
    const info = getFormatInfoForExt(ext);
    return info ? `${info.name} (.${String(ext || '').toUpperCase()})` : `.${String(ext || '').toUpperCase()}`;
}

function getConversionSummaryForExt(ext) {
    const summaries = {
        md: {
            preserved: '제목, 본문, 목록, 표, 코드블록, 일부 굵게/기울임, 구분선',
            lossy: '이미지, 복잡한 HTML, 사용자 정의 스타일, 정교한 페이지 레이아웃',
        },
        markdown: {
            preserved: '제목, 본문, 목록, 표, 코드블록, 일부 굵게/기울임, 구분선',
            lossy: '이미지, 복잡한 HTML, 사용자 정의 스타일, 정교한 페이지 레이아웃',
        },
        html: {
            preserved: '텍스트 구조, 제목, 목록, 표, 일부 인라인 서식',
            lossy: 'CSS 레이아웃, 이미지, 스크립트, 폼, 외부 리소스',
        },
        htm: {
            preserved: '텍스트 구조, 제목, 목록, 표, 일부 인라인 서식',
            lossy: 'CSS 레이아웃, 이미지, 스크립트, 폼, 외부 리소스',
        },
        docx: {
            preserved: '본문 텍스트, 제목 추정, 표, 일부 굵게/기울임',
            lossy: '이미지, 머리글/바닥글, 각주, 주석, 복잡한 스타일과 레이아웃',
        },
        csv: {
            preserved: '첫 행 기준 표 머리글, 셀 텍스트, 숫자 셀 정렬',
            lossy: '셀 병합, 수식, 색상, 시트 서식',
        },
        xlsx: {
            preserved: '첫 번째 시트의 표 데이터, 첫 행 머리글, 셀 텍스트',
            lossy: '여러 시트, 수식 결과 외 수식 자체, 차트, 이미지, 셀 병합과 세부 서식',
        },
        xls: {
            preserved: '첫 번째 시트의 표 데이터, 첫 행 머리글, 셀 텍스트',
            lossy: '여러 시트, 수식 결과 외 수식 자체, 차트, 이미지, 셀 병합과 세부 서식',
        },
        json: {
            preserved: '제목, 배열 목록, 객체 표, 기본 텍스트 값',
            lossy: '깊은 중첩 구조, 데이터 타입 의미, 원본 들여쓰기',
        },
        ipynb: {
            preserved: '마크다운 셀, 코드 셀 텍스트, 텍스트 출력 일부',
            lossy: '실행 상태, 이미지 출력, 위젯, 그래프, 노트북 메타데이터',
        },
        hwp: {
            preserved: 'HWPX 계열 XML 텍스트 일부 또는 HWP5 안내 메시지',
            lossy: 'HWP5 바이너리 본문, 이미지, 복잡한 한글 서식',
        },
        hwpx: {
            preserved: 'HWPX 섹션 XML의 텍스트와 일부 표',
            lossy: '원본 스타일, 이미지, 개체, 머리글/바닥글, 세밀한 레이아웃',
        },
    };
    return summaries[ext] || {
        preserved: '텍스트 중심 구조',
        lossy: '이미지, 복잡한 서식, 외부 리소스, 정교한 레이아웃',
    };
}

function getConversionSummary() {
    const ext = state.file ? getFileExtension(state.file.name) : '';
    return getConversionSummaryForExt(ext);
}

/** 결과 영역 숨기기 및 내용 초기화 */
function hideResult() {
    const area = document.getElementById('result-area');
    if (area) {
        area.style.display = 'none';
        area.innerHTML = '';
    }
    const ind = document.getElementById('dl-indicator');
    if (ind) ind.hidden = true;
}

function triggerDownload(url, fileName) {
    // 다운로드 준비 인디케이터 표시 → 브라우저 다운로드 다이얼로그 나타나기 전 대기 시각화
    const ind = document.getElementById('dl-indicator');
    if (ind) {
        ind.hidden = false;
        setTimeout(() => { ind.hidden = true; }, 2800);
    }

    const a = document.createElement('a');
    a.href = url;
    a.download = normalizeHwpxFileName(fileName);
    a.type = 'application/hwp+zip';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function normalizeHwpxFileName(fileName) {
    const base = String(fileName || 'document.hwpx').trim() || 'document.hwpx';
    return base.toLowerCase().endsWith('.hwpx') ? base : base.replace(/\.[^.]+$/, '') + '.hwpx';
}

function ensureHwpxBlob(blob) {
    if (!blob) return blob;
    if (blob.type === 'application/hwp+zip') return blob;
    return new Blob([blob], { type: 'application/hwp+zip' });
}

function revokeDownloadUrl() {
    if (state.downloadTimer) {
        clearTimeout(state.downloadTimer);
        state.downloadTimer = null;
    }
    if (state.downloadUrl) {
        URL.revokeObjectURL(state.downloadUrl);
        state.downloadUrl = null;
    }
}

function syncMarginInputs() {
    for (const side of ['top', 'bottom', 'left', 'right', 'header', 'footer']) {
        const el = document.getElementById(`margin-${side}`);
        if (!el) continue;
        const val = parseFloat(el.value);
        if (isNaN(val)) {
            el.value = state.pageMargins[side];
            continue;
        }
        const max = (side === 'header' || side === 'footer') ? 30 : 60;
        state.pageMargins[side] = Math.max(0, Math.min(max, val));
        el.value = state.pageMargins[side];
    }
}

function applyOrientationUi(orientation) {
    const landscape = orientation === 'landscape';
    const orientBtn = document.getElementById('paper-orient');
    if (!orientBtn) return;
    const orientLabel = orientBtn.querySelector('.orient-label');
    orientBtn.classList.toggle('is-landscape', landscape);
    orientBtn.setAttribute('aria-label', `용지 방향: ${landscape ? '가로' : '세로'}`);
    if (orientLabel) orientLabel.textContent = landscape ? '가로' : '세로';
}


// ─────────────────────────────────────────────────────────────────────────
// [진행률 표시]
// ─────────────────────────────────────────────────────────────────────────

/** 진행률 바와 퍼센트 텍스트 업데이트 */
function setProgress(pct) {
    const bar  = document.getElementById('progress-bar');
    const text = document.getElementById('progress-pct');
    if (bar)  bar.style.width = Math.min(100, pct) + '%';
    if (text) text.textContent = Math.min(100, pct) + '%';
    setProgressValue(pct);
}

function setProgressValue(pct) {
    const wrap = document.querySelector('.progress-wrap');
    if (wrap) wrap.setAttribute('aria-valuenow', String(Math.min(100, pct)));
}

/** 상태 텍스트 업데이트 */
function setStatusText(msg) {
    const el = document.getElementById('status-text');
    if (el) el.textContent = msg;
}

function setProgressPanelState(stateName) {
    const panel = document.querySelector('.progress-panel');
    const empty = document.getElementById('progress-empty');
    if (!panel) return;

    panel.classList.remove('is-empty', 'is-ready', 'is-converting', 'is-success', 'is-warning', 'is-error');
    panel.classList.add(`is-${stateName}`);

    const copy = {
        empty: ['파일을 선택하면 변환 준비 상태가 표시됩니다.', '아직 진행 중인 변환이 없습니다.'],
        ready: ['기본 옵션을 확인한 뒤 변환을 시작하세요.', '진행률은 변환 버튼을 누르면 표시됩니다.'],
        converting: ['변환 중입니다.', '파일 분석, HWPX 생성, 구조 검증을 순서대로 진행합니다.'],
        success: ['변환이 완료되었습니다.', '결과를 확인하거나 HWPX 파일을 다운로드하세요.'],
        warning: ['변환은 완료되었지만 확인이 필요합니다.', '결과 카드의 구조 검증 경고를 확인하세요.'],
        error: ['변환에 실패했습니다.', '상단 알림의 오류 내용을 확인한 뒤 다시 시도하세요.'],
    }[stateName] || null;

    if (empty && copy) {
        empty.innerHTML = `<strong>${escHtml(copy[0])}</strong><span>${escHtml(copy[1])}</span>`;
    }
}


// ─────────────────────────────────────────────────────────────────────────
// [알림 표시]
// ─────────────────────────────────────────────────────────────────────────

/** 오류/경고 알림 표시 (6초 후 자동 숨김) */
function showAlert(msg) {
    const el    = document.getElementById('alert-box');
    const msgEl = document.getElementById('alert-msg');
    if (!el || !msgEl) return;

    // [버그 수정] 이전에 el.textContent로 전체를 덮으면 닫기 버튼(.alert-close)이 삭제됨
    //             msgEl(#alert-msg span)만 업데이트해야 닫기 버튼이 유지됨
    // [보안] textContent = XSS 불가 (HTML 파싱 없이 텍스트로 처리)
    msgEl.textContent = msg;
    el.style.display  = 'flex';

    // once: true → 같은 버튼에 중복 이벤트 등록 방지
    el.querySelector('.alert-close')?.addEventListener('click', hideAlert, { once: true });

    // 연속 호출 시 이전 타이머 취소 후 재설정 (누적 방지)
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(hideAlert, 6000);
}

function hideAlert() {
    const el = document.getElementById('alert-box');
    if (el) el.style.display = 'none';
}


// ─────────────────────────────────────────────────────────────────────────
// [헤더 + 내비게이션]
// ─────────────────────────────────────────────────────────────────────────

/** 스크롤 시 헤더에 그림자 효과 추가 */
function initScrollBehavior() {
    const header = document.querySelector('.site-header');
    if (!header) return;

    window.addEventListener('scroll', () => {
        header.classList.toggle('scrolled', window.scrollY > 20);
    }, { passive: true });  // passive: true = 스크롤 성능 최적화
}

/** 모바일 햄버거 메뉴 열기/닫기 */
function initMobileMenu() {
    const toggle = document.getElementById('menu-toggle');
    const nav    = document.getElementById('main-nav');
    if (!toggle || !nav) return;

    toggle.addEventListener('click', () => {
        const isOpen = nav.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(isOpen));
        toggle.textContent = isOpen ? '✕' : '☰';
    });

    // 메뉴 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        if (!nav.contains(e.target) && !toggle.contains(e.target)) {
            nav.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
            toggle.textContent = '☰';
        }
    });
}

/** 내비게이션 링크 클릭 시 부드러운 스크롤 */
function initNavLinks() {
    document.querySelectorAll('a[href^="#"]').forEach(link => {
        link.addEventListener('click', (e) => {
            const targetId = link.getAttribute('href').slice(1);
            const target   = document.getElementById(targetId);
            if (target) {
                e.preventDefault();
                // 모바일 메뉴 닫기
                document.getElementById('main-nav')?.classList.remove('open');
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}


// ─────────────────────────────────────────────────────────────────────────
// [유틸리티 함수]
// ─────────────────────────────────────────────────────────────────────────

/**
 * 이벤트 루프에 제어권을 잠시 넘겨 DOM 업데이트가 화면에 반영되도록 함
 * async 파이프라인에서 UI 애니메이션이 즉시 표시되도록 하는 패턴
 */
function tick() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * 바이트 수 → 사람이 읽기 쉬운 크기 문자열 변환
 * 예) 2097152 → "2.00 MB"
 */
function formatBytes(bytes) {
    if (bytes < 1024)          return bytes + ' B';
    if (bytes < 1024 * 1024)   return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

/**
 * HTML 특수문자 이스케이프
 * [보안] innerHTML에 사용자 입력값(파일명, 경로 등)을 삽입할 때 반드시 사용
 *        미적용 시 XSS 취약점 발생 가능
 */
function escHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * 파일 확장자에 해당하는 이모지 아이콘 반환
 * [수정 시] 새 포맷 추가 시 여기에도 항목 추가
 */
function getFormatIcon(ext) {
    const map = {
        md: '📝', markdown: '📝',
        html: '🌐', htm: '🌐',
        txt: '📄', text: '📄',
        csv: '📊', xlsx: '📊', xls: '📊',
        json: '{ }',
        ipynb: '🔬',
        docx: '📘', doc: '📘',
        hwp: '🇰🇷',
        pdf: '📕',
        pptx: '📑', ppt: '📑',
        odt: '📃', rtf: '📃',
        epub: '📚',
    };
    return map[ext.toLowerCase()] || '📄';
}


// ─────────────────────────────────────────────────────────────────────────
// [모달 초기화]
//   미리보기·업데이트 내역 모달의 열기/닫기·탭 이벤트 등록
// ─────────────────────────────────────────────────────────────────────────
function initModals() {
    // 닫기 버튼
    document.getElementById('close-preview')?.addEventListener('click', closePreview);
    document.getElementById('close-changelog')?.addEventListener('click', closeChangelog);
    document.getElementById('close-pc-guide')?.addEventListener('click', closePcGuide);
    document.getElementById('close-mobile-guide')?.addEventListener('click', closeMobileGuide);
    document.getElementById('close-install-guide')?.addEventListener('click', closeInstallGuide);
    document.getElementById('close-font-guide')?.addEventListener('click', closeFontGuide);
    document.getElementById('recheck-fonts-btn')?.addEventListener('click', () => renderFontGuide());

    // 업데이트 내역 열기 버튼 (유틸리티 바)
    document.getElementById('open-changelog')?.addEventListener('click', showChangelog);
    document.getElementById('open-pc-guide')?.addEventListener('click', showPcGuide);
    document.getElementById('open-mobile-guide')?.addEventListener('click', showMobileGuide);
    document.getElementById('open-install-guide')?.addEventListener('click', showInstallGuide);
    document.getElementById('open-font-guide')?.addEventListener('click', showFontGuide);

    // 오버레이 바깥 클릭으로 닫기
    document.getElementById('preview-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closePreview();
    });
    document.getElementById('changelog-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeChangelog();
    });
    document.getElementById('pc-guide-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closePcGuide();
    });
    document.getElementById('mobile-guide-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeMobileGuide();
    });
    document.getElementById('install-guide-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeInstallGuide();
    });
    document.getElementById('font-guide-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeFontGuide();
    });

    // ESC 키로 닫기
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closePreview();
            closeChangelog();
            closePcGuide();
            closeMobileGuide();
            closeInstallGuide();
            closeFontGuide();
        }
    });

    // 체인지로그 탭 전환
    document.querySelectorAll('.changelog-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.changelog-tab').forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            renderChangelogContent(tab.dataset.tab);
        });
    });
}

function closePreview() {
    document.getElementById('preview-modal')?.classList.remove('open');
    document.body.style.overflow = '';
}

function closeChangelog() {
    document.getElementById('changelog-modal')?.classList.remove('open');
    document.body.style.overflow = '';
}

function showPcGuide() {
    document.getElementById('pc-guide-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closePcGuide() {
    document.getElementById('pc-guide-modal')?.classList.remove('open');
    document.body.style.overflow = '';
}

function showMobileGuide() {
    document.getElementById('mobile-guide-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeMobileGuide() {
    document.getElementById('mobile-guide-modal')?.classList.remove('open');
    document.body.style.overflow = '';
}

function showInstallGuide() {
    document.getElementById('install-guide-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeInstallGuide() {
    document.getElementById('install-guide-modal')?.classList.remove('open');
    document.body.style.overflow = '';
}


// ─────────────────────────────────────────────────────────────────────────
// [변환기 섹션 통합 드롭 영역]
//   히어로 드롭존과 달리 옵션 패널 상단에 위치 — 클릭·드래그 모두 지원
//   파일 선택 시 .has-file 클래스로 상태 전환 (updateDropZoneUI에서 처리)
// ─────────────────────────────────────────────────────────────────────────
function initConverterDropArea() {
    const area      = document.getElementById('converter-drop-area');
    const fileInput = document.getElementById('file-input');
    if (!area || !fileInput) return;

    area.addEventListener('click', () => fileInput.click());
    area.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') fileInput.click();
    });
    area.addEventListener('dragover', e => {
        e.preventDefault();
        area.classList.add('drag-over');
    });
    area.addEventListener('dragleave', e => {
        if (!area.contains(e.relatedTarget)) area.classList.remove('drag-over');
    });
    area.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        area.classList.remove('drag-over');
        handleFileList(e.dataTransfer?.files);
    });
}

// ─────────────────────────────────────────────────────────────────────────
// [즐겨찾기 안내 버튼]
// ─────────────────────────────────────────────────────────────────────────
function initBookmarkButton() {
    const btn = document.getElementById('bookmark-btn');
    if (!btn) return;

    let _toastTimer = null;

    btn.addEventListener('click', () => {
        // 기존 토스트 제거
        document.getElementById('bookmark-toast')?.remove();
        clearTimeout(_toastTimer);

        const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
        const key   = isMac ? '⌘D' : 'Ctrl+D';

        const toast = document.createElement('div');
        toast.id        = 'bookmark-toast';
        toast.className = 'bookmark-toast';
        toast.innerHTML = `<strong>${key}</strong>를 눌러 즐겨찾기에 추가하세요 <span>브라우저 보안상 자동 추가는 지원되지 않습니다.</span><button class="bookmark-toast-close" aria-label="닫기">✕</button>`;
        document.body.appendChild(toast);

        toast.querySelector('.bookmark-toast-close').addEventListener('click', () => toast.remove());

        // 4초 후 자동 제거
        _toastTimer = setTimeout(() => toast.remove(), 4000);
        requestAnimationFrame(() => toast.classList.add('bookmark-toast--show'));
    });
}

function initResetButton() {
    const btn = document.getElementById('reset-btn');
    if (!btn) return;
    btn.addEventListener('click', resetConverterState);
}

function resetConverterState() {
    clearSelectedFile();
    hideAlert();

    state.docType = 'plain';
    state.customTitle = '';
    state.docFont = '맑은 고딕';
    state.fontSize = 12;
    state.paperSize = 'A4';
    state.orientation = 'portrait';
    state.pageMargins = { top: 10, bottom: 10, left: 20, right: 20, header: 10, footer: 10 };
    state.autoDownload = true;

    for (const key of ['tohwpx_font', 'tohwpx_fontSize', 'tohwpx_paperSize', 'tohwpx_autoDownload', 'tohwpx_orientation']) {
        localStorage.removeItem(key);
    }

    const docType = document.getElementById('doc-type');
    const docFont = document.getElementById('doc-font');
    const fontSize = document.getElementById('font-size');
    const paperSize = document.getElementById('paper-size');
    const autoDownload = document.getElementById('auto-download');
    if (docType) docType.value = 'plain';
    if (docFont) docFont.value = '맑은 고딕';
    if (fontSize) fontSize.value = '12';
    if (paperSize) paperSize.value = 'A4';
    if (autoDownload) autoDownload.checked = true;

    for (const [side, value] of Object.entries(state.pageMargins)) {
        const el = document.getElementById(`margin-${side}`);
        if (el) el.value = value;
    }
    applyOrientationUi('portrait');
    updateConvertButton(false);
    document.getElementById('hero-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showAlert('선택 파일과 변환 옵션을 기본값으로 초기화했습니다.');
}


// ─────────────────────────────────────────────────────────────────────────
// [rhwp 뷰어 클라이언트]
//   외부 rhwp iframe이 postMessage API에 응답하는 경우에만 사용한다.
//   응답하지 않으면 openPreview()가 내장 HWPX 구조 미리보기로 전환한다.
// ─────────────────────────────────────────────────────────────────────────
class RhwpEditorClient {
    constructor(iframeEl) {
        this._iframe  = iframeEl;
        this._pending = new Map();
        this._reqId   = 0;
        window.addEventListener('message', e => this._onMessage(e));
    }

    _onMessage(e) {
        if (!e.data || e.data.type !== 'rhwp-response' || e.data.id == null) return;
        const cb = this._pending.get(e.data.id);
        if (!cb) return;
        this._pending.delete(e.data.id);
        e.data.error ? cb.reject(new Error(e.data.error)) : cb.resolve(e.data.result);
    }

    _send(method, params = {}, timeoutMs = 10000) {
        const id = ++this._reqId;
        return new Promise((resolve, reject) => {
            this._pending.set(id, { resolve, reject });
            this._iframe.contentWindow.postMessage(
                { type: 'rhwp-request', id, method, params }, '*'
            );
            setTimeout(() => {
                if (this._pending.has(id)) {
                    this._pending.delete(id);
                    reject(new Error(`rhwp timeout: ${method}`));
                }
            }, timeoutMs);
        });
    }

    // WASM 로드 완료까지 최대 15초(30회 × 500ms) 대기
    // rhwp 내부 API: 'ready' 메서드로 준비 확인
    async waitReady() {
        for (let i = 0; i < 30; i++) {
            try {
                const ok = await this._send('ready', {}, 1500);
                if (ok) return;
            } catch (_) {
                await new Promise(r => setTimeout(r, 500));
            }
        }
        throw new Error('rhwp 뷰어가 응답하지 않습니다 (WASM 로드 실패)');
    }

    // 반환값: { pageCount: number }
    async loadFile(buf, fileName = 'document.hwpx') {
        const bytes = buf instanceof ArrayBuffer
            ? Array.from(new Uint8Array(buf))
            : Array.from(buf);
        return this._send('loadFile', { data: bytes, fileName }, 20000);
    }
}

let _rhwpClient = null;

function getXmlNodesByName(root, localName) {
    return [
        ...Array.from(root.getElementsByTagNameNS('*', localName)),
        ...Array.from(root.getElementsByTagName(localName)),
        ...Array.from(root.getElementsByTagName(`hp:${localName}`)),
    ].filter((node, index, arr) => arr.indexOf(node) === index);
}

function hwpUnitToMm(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${(n / 283.465).toFixed(1)}mm` : '-';
}

function buildFallbackParagraphs(sectionXml, previewText) {
    const doc = new DOMParser().parseFromString(sectionXml || '', 'application/xml');
    const parseError = getXmlNodesByName(doc, 'parsererror')[0];
    if (parseError) {
        return {
            margins: null,
            tableCount: 0,
            paragraphs: previewText ? previewText.split(/\r?\n/).filter(Boolean) : [],
        };
    }

    const margins = getXmlNodesByName(doc, 'margin')[0] || null;
    const tableCount = getXmlNodesByName(doc, 'tbl').length;
    const pNodes = getXmlNodesByName(doc, 'p');
    const paragraphs = pNodes.map(p => {
        const text = getXmlNodesByName(p, 't')
            .map(node => node.textContent || '')
            .join('')
            .trim();
        return text;
    }).filter(Boolean);

    if (!paragraphs.length && previewText) {
        paragraphs.push(...previewText.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
    }

    return { margins, tableCount, paragraphs };
}

async function renderBuiltInPreview(blob, sourceError, loading, countEl) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip이 로드되지 않았습니다.');

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const sectionFile = zip.file('Contents/section0.xml');
    if (!sectionFile) throw new Error('Contents/section0.xml을 찾을 수 없습니다.');

    const [sectionXml, previewText] = await Promise.all([
        sectionFile.async('string'),
        zip.file('Preview/PrvText.txt')?.async('string').catch(() => '') || '',
    ]);
    const { margins, tableCount, paragraphs } = buildFallbackParagraphs(sectionXml, previewText);
    const fileName = (state.file?.name || 'document').replace(/\.[^.]+$/, '') + '.hwpx';
    const shown = paragraphs.slice(0, 120);
    const marginItems = margins ? [
        ['위', 'top'], ['아래', 'bottom'], ['왼쪽', 'left'], ['오른쪽', 'right'],
        ['머리말', 'header'], ['꼬리말', 'footer'],
    ].map(([label, attr]) => `
        <span><strong>${label}</strong>${hwpUnitToMm(margins.getAttribute(attr))}</span>
    `).join('') : '<span>여백 정보를 찾지 못했습니다.</span>';

    loading.classList.add('preview-loading--fallback');
    loading.style.display = 'flex';
    loading.innerHTML = `
        <div class="fallback-preview">
            <div class="fallback-preview-head">
                <div>
                    <strong>HWPX 텍스트 미리보기</strong>
                    <p>생성된 HWPX 내용을 텍스트로 표시합니다. 정확한 서식은 한컴오피스에서 확인하세요.</p>
                </div>
                ${state.downloadUrl ? `<a class="fallback-download" href="${state.downloadUrl}" download="${escHtml(fileName)}">다운로드</a>` : ''}
            </div>
            <div class="fallback-notice">
                외부 미리보기 뷰어가 응답하지 않아 내장 텍스트 미리보기로 전환되었습니다.
            </div>
            <div class="fallback-meta">
                <span><strong>파일</strong>${escHtml(fileName)}</span>
                <span><strong>표</strong>${tableCount}개</span>
                ${marginItems}
            </div>
            <div class="fallback-doc">
                ${shown.length
                    ? shown.map(text => `<p>${escHtml(text)}</p>`).join('')
                    : '<p class="fallback-empty">표시할 텍스트가 없습니다. 다운로드한 HWPX를 한컴오피스에서 확인해 주세요.</p>'}
            </div>
        </div>`;

    if (countEl) countEl.textContent = `구조 미리보기 · ${paragraphs.length}문단`;
}

/** 미리보기 모달 열기 — HWPX Blob을 rhwp iframe에 로드 */
async function openPreview(blob) {
    const modal   = document.getElementById('preview-modal');
    const loading = document.getElementById('preview-loading');
    const iframe  = document.getElementById('rhwp-iframe');
    const countEl = document.getElementById('preview-pagecount');
    if (!modal || !iframe || !blob) return;

    // 모달 표시
    modal.classList.add('open');
    loading.classList.remove('preview-loading--fallback');
    loading.style.display = 'flex';

    // 5초 후 건너뛰기 버튼 표시 — 사용자가 기다리다 닫는 상황 방지
    let _skipResolve = null;
    const skipPromise = new Promise(resolve => { _skipResolve = resolve; });

    loading.innerHTML = `
        <div style="text-align:center">
            <div class="loading-spinner"></div>
            <p>rhwp 뷰어를 불러오는 중...</p>
            <p class="preview-loading-sub">최초 실행 시 WebAssembly 로드로 10~20초 소요될 수 있습니다</p>
            <button id="skip-rhwp-btn" class="btn-skip-rhwp" style="display:none;margin-top:14px">
                내장 미리보기로 바로 전환
            </button>
        </div>`;

    const skipBtn = document.getElementById('skip-rhwp-btn');
    if (skipBtn) skipBtn.addEventListener('click', () => { if (_skipResolve) _skipResolve(); });
    const skipTimer = setTimeout(() => {
        if (skipBtn) skipBtn.style.display = 'inline-block';
    }, 5000);

    if (countEl) countEl.textContent = '';
    document.body.style.overflow = 'hidden';

    try {
        // 클라이언트 최초 초기화 (iframe이 바뀌지 않으면 재사용)
        if (!_rhwpClient) _rhwpClient = new RhwpEditorClient(iframe);

        // WASM 준비 대기 — 사용자 건너뛰기와 경쟁
        const isReady = await Promise.race([
            _rhwpClient.waitReady().then(() => true),
            skipPromise.then(() => false),
        ]);
        clearTimeout(skipTimer);

        if (!isReady) throw new Error('사용자가 내장 미리보기로 전환했습니다');

        // Blob → ArrayBuffer → rhwp 로드 (반환값: {pageCount: number})
        const buf      = await blob.arrayBuffer();
        const fileName = (state.file?.name || 'document').replace(/\.[^.]+$/, '') + '.hwpx';
        const result   = await _rhwpClient.loadFile(buf, fileName);

        if (result?.pageCount && countEl) {
            countEl.textContent = `총 ${result.pageCount}페이지`;
        }
        loading.style.display = 'none';
    } catch (err) {
        clearTimeout(skipTimer);
        console.error('[rhwp]', err);
        try {
            await renderBuiltInPreview(blob, err, loading, countEl);
        } catch (fallbackErr) {
            loading.classList.remove('preview-loading--fallback');
            loading.innerHTML = `
                <div style="text-align:center;padding:24px">
                    <p style="font-size:1.8rem;margin-bottom:10px">⚠</p>
                    <p style="font-weight:600;color:var(--c-error)">미리보기 로드 실패</p>
                    <p style="font-size:0.8rem;color:var(--c-text-muted);margin-top:6px">${escHtml(fallbackErr.message)}</p>
                    <p style="font-size:0.78rem;color:var(--c-text-muted);margin-top:4px">
                        생성된 HWPX는 다운로드 후 한컴오피스에서 확인할 수 있습니다.
                    </p>
                </div>`;
            console.error('[preview fallback]', fallbackErr);
        }
    }
}


// ─────────────────────────────────────────────────────────────────────────
// [업데이트 내역]
//   changelog.json 로드 후 버전별 사용자/개발자 변경사항 렌더링
// ─────────────────────────────────────────────────────────────────────────
let _changelogData = null;
let _changelogTab  = 'user';

/** 업데이트 내역 모달 열기 */
async function showChangelog() {
    const modal = document.getElementById('changelog-modal');
    if (!modal) return;

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    if (!_changelogData) {
        try {
            const res = await fetch('changelog.json');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            _changelogData = await res.json();
        } catch (e) {
            document.getElementById('changelog-content').innerHTML =
                '<p style="color:var(--c-error);text-align:center;padding:24px">업데이트 내역을 불러오지 못했습니다.</p>';
            return;
        }
    }
    renderChangelogContent(_changelogTab);
}

/** 선택된 탭(user|dev)에 맞게 changelog-content 렌더링 */
function renderChangelogContent(tab) {
    _changelogTab = tab;
    const el = document.getElementById('changelog-content');
    if (!el || !_changelogData) return;

    const groups = [];
    for (const version of _changelogData.versions || []) {
        const date = version.date || '날짜 없음';
        let group = groups.find(item => item.date === date);
        if (!group) {
            group = { date, versions: [] };
            groups.push(group);
        }
        group.versions.push(version);
    }

    el.innerHTML = groups.map(group => `
        <section class="changelog-date-group">
            <div class="changelog-date-heading">${escHtml(group.date)}</div>
            ${tab === 'user' ? renderMergedUserChangelog(group.versions) : renderVersionedChangelog(group.versions, tab)}
        </section>
    `).join('');
}

function versionLabel(version) {
    return version.range ? version.range : `v${version.version}`;
}

function renderMergedUserChangelog(versions) {
    const labels = versions.map(versionLabel);
    const mergedItems = [];
    const seen = new Set();
    for (const version of versions) {
        for (const item of version.user || []) {
            if (seen.has(item)) continue;
            seen.add(item);
            mergedItems.push(item);
        }
    }
    const badge = labels.length > 1 ? `${labels[labels.length - 1]} – ${labels[0]}` : labels[0];
    return `
        <div class="changelog-version">
            <div class="changelog-version-header">
                <span class="changelog-ver-badge">${escHtml(badge)}</span>
            </div>
            <ul class="changelog-list">
                ${mergedItems.map(item => `<li>${escHtml(item)}</li>`).join('')}
            </ul>
        </div>
    `;
}

function renderVersionedChangelog(versions, tab) {
    return versions.map(v => `
        <div class="changelog-version">
            <div class="changelog-version-header">
                <span class="changelog-ver-badge">${escHtml(versionLabel(v))}</span>
            </div>
            <ul class="changelog-list">
                ${(v[tab] || []).map(item => `<li>${escHtml(item)}</li>`).join('')}
            </ul>
        </div>
    `).join('');
}
