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
    inputMode:    'upload',            // 입력 방식: 'upload'(파일) | 'paste'(직접 입력)
    queue:        [],                  // 배치 변환 큐: [{id, file, ext, status, blob, url, fileName, validation, error}]
    file:         null,                // 현재 선택/변환 중 File 객체 (단일 참조 — 큐 길이 1과 동일 경로 호환용)
    ir:           null,                // 파싱 완료된 IR JSON
    docType:      'plain',             // 상단 제목 블록: plain(없음)|titleblock(기본)|cover-unit(표지단위)|cover-annual(표지연간)
    customTitle:  '',                  // 사용자가 입력한 제목 (비어 있으면 자동 기준 적용)
    titleSource:  'heading',           // 제목을 비웠을 때: 'filename'(파일 이름) | 'heading'(문서 첫 제목/문장)
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
let modalReturnFocus = null;

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
const SUPPORTED_FORMAT_LABEL = 'MD, HTML, TXT, CSV, XLSX, JSON, IPYNB, DOCX, HWP';

// ─────────────────────────────────────────────────────────────────────────
// [DOM 준비 후 초기화]
//   모든 기능 초기화를 DOMContentLoaded 이후 실행
// ─────────────────────────────────────────────────────────────────────────
// 새로고침(F5) 시 브라우저의 스크롤 복원을 끄고 항상 맨 위에서 시작
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

document.addEventListener('DOMContentLoaded', () => {
    window.scrollTo(0, 0);      // 새로고침 시 첫 화면(맨 위)으로
    renderPipelineSteps();      // 파이프라인 단계 DOM 렌더링
    setProgressPanelState('empty');
    initDropZone();             // 파일 드롭/선택 영역 (히어로 드롭존)
    initConverterDropArea();    // 변환기 섹션 통합 드롭 영역
    initFormatTabs();           // 포맷 탭 전환 (기본/확장 서비스)
    initFormatCards();          // 포맷 카드 클릭 이벤트
    initOptions();              // 문서 유형·제목·폰트·여백 옵션
    initInputMode();            // 입력 방식 탭(파일 업로드 / 직접 입력)
    initConvertButton();        // 변환 시작 버튼 + Ctrl/⌘+Enter 단축키
    initKeyboardShortcuts();     // Ctrl/⌘+O 파일 선택 등 공통 단축키
    initScrollBehavior();       // 스크롤 시 헤더 효과
    initMobileMenu();           // 모바일 햄버거 메뉴
    initNavLinks();             // 부드러운 스크롤 네비게이션
    initModals();               // 미리보기·업데이트 내역 모달
    initResetButton();          // 현재 선택 파일과 변환 옵션 초기화
    initTheme();                // 다크/라이트 테마 토글·시스템 동기화
    showFormatHintPlaceholder();// 파일 선택 전 포맷 힌트 영역 안내(빈칸 방지)
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

const MAX_BATCH_FILES = 20;

/**
 * 파일 입력/드롭 진입점 — 선택된 파일들을 검증해 변환 큐에 추가한다.
 * 단일 파일이면 큐 길이 1로, 기존 단일 변환 흐름과 동일하게 동작한다.
 */
function handleFileList(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (state.isConverting) {
        showToast('<strong>변환이 진행 중입니다</strong> <span>완료 후 파일을 추가해 주세요.</span>', { timeout: 4000 });
        return;
    }
    // 직접 입력 모드에서 파일이 들어오면 업로드 모드로 자동 전환
    if (state.inputMode === 'paste') setInputMode('upload');
    addFilesToQueue(files);
}

/** 확장자/크기를 파일별 검증해 통과분만 큐에 적재 */
function addFilesToQueue(files) {
    const skipped = [];
    const accepted = [];

    for (const file of files) {
        const ext = getFileExtension(file.name);
        if (!SUPPORTED_EXTENSIONS.has(ext)) {
            skipped.push(`${file.name} (미지원 형식)`);
            continue;
        }
        const MAX_MB = BINARY_EXTENSIONS.has(ext) ? 50 : 100;
        if (file.size > MAX_MB * 1024 * 1024) {
            skipped.push(`${file.name} (${MAX_MB}MB 초과)`);
            continue;
        }
        accepted.push({ file, ext });
    }

    // 최대 개수 제한 (이미 큐에 있는 항목 포함)
    let overflow = 0;
    const room = MAX_BATCH_FILES - state.queue.length;
    let toAdd = accepted;
    if (accepted.length > room) {
        overflow = accepted.length - Math.max(0, room);
        toAdd = accepted.slice(0, Math.max(0, room));
    }

    for (const { file, ext } of toAdd) {
        state.queue.push({
            id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            file, ext,
            status: 'pending',   // pending | converting | done | warn | error
            blob: null, url: null, fileName: null, validation: null, error: null,
        });
    }

    // 제외 안내(토스트)
    const notes = [];
    if (skipped.length) notes.push(`${skipped.length}개 제외(미지원/용량 초과)`);
    if (overflow)       notes.push(`최대 ${MAX_BATCH_FILES}개 초과로 ${overflow}개 제외`);
    if (notes.length) {
        showToast(`<strong>일부 파일을 제외했습니다</strong> <span>${escHtml(notes.join(' · '))}</span>`, { timeout: 6000 });
    }

    if (!state.queue.length) {
        if (!notes.length) {
            showToast(`<strong>지원하지 않는 파일 형식입니다</strong> <span>${escHtml(SUPPORTED_FORMAT_LABEL)} 파일을 선택해 주세요.</span>`, { timeout: 6000 });
        }
        clearSelectedFile();
        return;
    }

    onQueueChanged({ scroll: true });
}

/** 큐에서 항목 제거 (변환 시작 전 사용자 ✕) */
function removeQueueItem(id) {
    if (state.isConverting) return;
    const idx = state.queue.findIndex(q => q.id === id);
    if (idx === -1) return;
    const [removed] = state.queue.splice(idx, 1);
    if (removed?.url) URL.revokeObjectURL(removed.url);
    if (!state.queue.length) { clearSelectedFile(); return; }
    onQueueChanged({ scroll: false });
}

/**
 * 큐 변경 후 UI 일괄 동기화.
 * 길이 1 → 기존 단일 파일 UI / 길이 2+ → 배치 목록 UI
 */
function onQueueChanged({ scroll = false } = {}) {
    const n = state.queue.length;
    state.file = n ? state.queue[0].file : null;   // 단일 참조 호환
    state.ir = null;
    state.hwpxBlob = null;
    revokeAllQueueUrls();
    hideResult();
    resetPipeline();
    setProgressPanelState(n ? 'ready' : 'empty');
    updateConvertButton(n > 0);

    if (n === 1) {
        const { file, ext } = state.queue[0];
        updateDropZoneUI(file, ext);
        updateFormatBadge(ext);
        updateFormatExpectation(ext);
        setCustomTitleEnabled(true);
    } else {
        updateDropZoneMulti(n);
        setCustomTitleEnabled(false);
    }

    renderQueueList();
    updateTitlePlaceholder();

    if (scroll) {
        document.getElementById('converter')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

/** 배치(2개 이상)일 때 드롭존/배지/힌트를 '여러 개 선택됨' 상태로 */
function updateDropZoneMulti(n) {
    const dz = document.getElementById('drop-zone');
    if (dz) {
        dz.innerHTML = `
            <div class="file-selected-info">
                <span class="file-emoji">📚</span>
                <div class="file-meta">
                    <strong class="file-name">${n}개 파일 선택됨</strong>
                    <span class="file-size">배치 변환 — 각 파일을 개별 HWPX로 변환합니다</span>
                </div>
                <button class="file-change" onclick="document.getElementById('file-input').click()">
                    파일 추가/변경
                </button>
            </div>
        `;
    }
    const cda      = document.getElementById('converter-drop-area');
    const cdaLabel = document.getElementById('cda-label');
    if (cda)      cda.classList.add('has-file');
    if (cdaLabel) cdaLabel.textContent = `${n}개 파일 선택됨 — 파일 추가/변경`;

    const badge = document.getElementById('detected-format');
    if (badge) { badge.textContent = `${n}개`; badge.style.display = 'inline-block'; }

    // 여러 포맷이 섞일 수 있으므로 포맷 힌트는 일반 배치 안내로
    const hint = document.getElementById('format-hint');
    if (hint) {
        hint.innerHTML = `
            <div class="format-hint-head">
                <strong>${n}개 파일 배치 변환</strong>
                <span>개별 HWPX + ZIP</span>
            </div>
            <div class="format-hint-body">
                <span><b>공통 적용</b> 아래 고급 설정(글꼴·크기·용지·여백)이 모든 파일에 적용됩니다</span>
                <span><b>제목</b> 파일별 제목 기준 규칙으로 자동 생성됩니다</span>
            </div>
        `;
        hint.style.display = 'block';
    }
}

/** 선택한 파일 목록(배치) 렌더 — 2개 이상일 때만 표시 */
function renderQueueList() {
    const box = document.getElementById('file-queue');
    if (!box) return;
    if (state.queue.length < 2) {
        box.hidden = true;
        box.innerHTML = '';
        return;
    }
    box.hidden = false;
    const canEdit = !state.isConverting;
    box.innerHTML = `
        <div class="file-queue-head">
            <strong>선택한 파일 ${state.queue.length}개</strong>
            ${canEdit ? '<button type="button" class="file-queue-clear" id="queue-clear-btn">모두 비우기</button>' : ''}
        </div>
        <ul class="file-queue-list">
            ${state.queue.map(item => `
                <li class="file-queue-item is-${item.status}" data-id="${item.id}">
                    <span class="fq-icon">${getFormatIcon(item.ext)}</span>
                    <span class="fq-name" title="${escHtml(item.file.name)}">${escHtml(item.file.name)}</span>
                    <span class="fq-size">${formatBytes(item.file.size)}</span>
                    <span class="fq-status">${queueStatusLabel(item)}</span>
                    ${canEdit ? `<button type="button" class="fq-remove" data-id="${item.id}" aria-label="${escHtml(item.file.name)} 제거">✕</button>` : ''}
                </li>
            `).join('')}
        </ul>
    `;
    if (canEdit) {
        box.querySelector('#queue-clear-btn')?.addEventListener('click', () => { if (!state.isConverting) clearSelectedFile(); });
        box.querySelectorAll('.fq-remove').forEach(btn => {
            btn.addEventListener('click', () => removeQueueItem(btn.dataset.id));
        });
    }
}

function queueStatusLabel(item) {
    switch (item.status) {
        case 'converting': return '<span class="fq-badge fq-badge--run">변환 중…</span>';
        case 'done':       return '<span class="fq-badge fq-badge--ok">완료</span>';
        case 'warn':       return '<span class="fq-badge fq-badge--warn">경고</span>';
        case 'error':      return '<span class="fq-badge fq-badge--err">실패</span>';
        default:           return '<span class="fq-badge fq-badge--wait">대기</span>';
    }
}

/** 배치일 때 문서 제목 입력 비활성화(파일별 자동 제목 사용) */
function setCustomTitleEnabled(enabled) {
    const titleEl = document.getElementById('doc-title');
    if (titleEl) {
        titleEl.disabled = !enabled;
        titleEl.title = enabled ? '' : '여러 파일을 변환할 때는 파일별 제목 기준 규칙이 적용됩니다';
    }
    const help = document.querySelector('.title-help');
    if (help) {
        help.innerHTML = enabled
            ? '<b>고급 설정의 상단 제목 블록</b>을 켜면 이 제목이 문서 맨 위에 표시됩니다.'
            : '여러 파일은 <b>제목 기준 규칙</b>으로 파일마다 제목을 자동 생성합니다.';
    }
}

function clearSelectedFile() {
    state.queue = [];
    state.file = null;
    state.ir = null;
    state.hwpxBlob = null;
    revokeAllQueueUrls();
    hideResult();
    resetPipeline();
    setProgressPanelState('empty');
    updateConvertButton(false);
    renderQueueList();           // #file-queue 숨김/비움
    setCustomTitleEnabled(true); // 제목 입력 재활성

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
            <div class="drop-sub">입력: MD · HTML · TXT · CSV · XLSX · JSON · IPYNB · DOCX · HWP (여러 개 가능)<br>출력: HWPX</div>
        `;
    }

    const cda = document.getElementById('converter-drop-area');
    const cdaLabel = document.getElementById('cda-label');
    if (cda) cda.classList.remove('has-file');
    if (cdaLabel) cdaLabel.textContent = '파일을 드래그하거나 클릭하여 선택 (여러 개 가능)';

    showFormatHintPlaceholder();   // 파일 전: 빈칸 대신 안내 placeholder로 레이아웃 유지

    const titleInput = document.getElementById('doc-title');
    if (titleInput) {
        titleInput.value = '';
        updateTitlePlaceholder();
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

/** 파일 선택 전 포맷 힌트 영역에 안내 placeholder를 채워 레이아웃을 안정시킨다 */
function showFormatHintPlaceholder() {
    const hint = document.getElementById('format-hint');
    if (!hint) return;
    hint.innerHTML = '<div class="format-hint-empty">파일을 선택하면 형식과 보존 정보가 여기에 표시됩니다.</div>';
    hint.style.display = 'block';
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

function fileBaseName(file) {
    return (file?.name || '').replace(/\.[^.]+$/, '').trim();
}

function normalizeTitleCandidate(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function isGenericTitleCandidate(text) {
    const compact = normalizeTitleCandidate(text).toLowerCase().replace(/[\s:：\-–—_()[\]{}]+/g, '');
    return [
        '문서구성', '목차', '차례', '개요', '본문', '내용', '소개', '서론',
        'tableofcontents', 'contents', 'outline', 'overview', 'introduction'
    ].includes(compact);
}

function restoreTitleToBodyIfNeeded(ir, titleText, finalTitle) {
    const text = normalizeTitleCandidate(titleText);
    if (!text || text === normalizeTitleCandidate(finalTitle)) return;
    if (!Array.isArray(ir.blocks)) ir.blocks = [];
    const alreadyInBody = ir.blocks.some(block => blockTitleText(block) === text);
    if (!alreadyInBody) ir.blocks.unshift({ type: 'heading', level: 1, text });
}

function blockTitleText(block) {
    if (!block) return '';
    if (typeof block.text === 'string') return normalizeTitleCandidate(block.text);
    if (Array.isArray(block.runs)) {
        return normalizeTitleCandidate(block.runs.map(run => run?.text || '').join(''));
    }
    return '';
}

function findFirstDocumentTitleCandidate(ir) {
    const blocks = Array.isArray(ir.blocks) ? ir.blocks : [];
    for (const block of blocks) {
        if (!['heading', 'para'].includes(block?.type)) continue;
        const text = blockTitleText(block);
        if (!text || isGenericTitleCandidate(text)) continue;
        return { block, text };
    }
    return null;
}

function applyDocumentTitlePolicy(ir, file, customTitle, titleSource) {
    const fallback = fileBaseName(file);
    const ext = getFileExtension(file?.name || '');
    const parsedTitle = normalizeTitleCandidate(ir.title);
    const direct = normalizeTitleCandidate(customTitle);
    if (direct) {
        restoreTitleToBodyIfNeeded(ir, parsedTitle, direct);
        ir.title = direct;
        return;
    }

    if (titleSource === 'filename') {
        restoreTitleToBodyIfNeeded(ir, parsedTitle, fallback);
        ir.title = fallback;
        return;
    }

    if (ext !== 'docx' && parsedTitle && !isGenericTitleCandidate(parsedTitle)) {
        ir.title = parsedTitle;
        return;
    }

    const firstTitle = findFirstDocumentTitleCandidate(ir);
    if (firstTitle) {
        ir.title = firstTitle.text;
        if (firstTitle.block.type === 'heading') {
            ir.blocks.splice(ir.blocks.indexOf(firstTitle.block), 1);
        }
        return;
    }

    if (parsedTitle && !isGenericTitleCandidate(parsedTitle)) {
        ir.title = parsedTitle;
        return;
    }

    ir.title = fallback;
}


// ─────────────────────────────────────────────────────────────────────────
// [포맷 탭 전환]
//   기본 서비스 / 확장 서비스 탭 클릭 시 해당 패널 표시
// ─────────────────────────────────────────────────────────────────────────
function initFormatTabs() {
    const tabs = document.querySelectorAll('.format-tab');
    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => {
            const scope = tab.closest('.service-info') || document;
            const shouldOpen = !tab.classList.contains('active');
            // 모든 탭 비활성화 후 클릭된 탭만 활성화
            scope.querySelectorAll('.format-tab').forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            if (shouldOpen) {
                tab.classList.add('active');
                tab.setAttribute('aria-selected', 'true');
            }

            // 연결된 패널 표시 (data-target 속성으로 매핑)
            const targetId = tab.dataset.target;
            scope.querySelectorAll('.format-panel').forEach(panel => {
                panel.classList.toggle('active', shouldOpen && panel.id === targetId);
            });
        });
        tab.addEventListener('keydown', (e) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            const scopeTabs = Array.from((tab.closest('.service-info') || document).querySelectorAll('.format-tab'));
            const current = scopeTabs.indexOf(tab);
            let next = current;
            if (e.key === 'ArrowRight') next = (current + 1) % scopeTabs.length;
            if (e.key === 'ArrowLeft') next = (current - 1 + scopeTabs.length) % scopeTabs.length;
            if (e.key === 'Home') next = 0;
            if (e.key === 'End') next = scopeTabs.length - 1;
            e.preventDefault();
            scopeTabs[next].focus();
            scopeTabs[next].click();
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
        desc: '문서 구조가 텍스트로 명확히 드러나는 형식이라 현재 서비스에서 가장 안정적인 입력 포맷입니다.',
        tech: 'marked.js 토큰 분석 → 자체 보정 → IR(중간 표현) → HWPX',
        features: [
            '제목(H1~H6), 문단, 목록, 표, 코드블록, 링크 텍스트를 중심으로 보존',
            '구두점에 붙은 **굵게**·따옴표·앰퍼샌드(&)·부등호(<,>)도 정확히 처리',
            'GitHub Flavored Markdown 표와 머리행, 순서/비순서 목록, 태스크리스트(☑/□) 지원',
            '코드블록(검정 배경·흰 글자), 인라인 코드, 인용구(왼쪽 선·옅은 배경) 지원',
            '일반적으로 Markdown은 시각 디자인보다 내용 구조 보존에 강함',
        ],
        limits: ['이미지 미지원', '복잡한 인라인 HTML과 사용자 정의 스타일은 제외 가능', '페이지 단위 레이아웃은 새 HWPX 기본 흐름으로 재구성'],
    },
    html: {
        icon: '🌐', name: 'HTML 문서',
        quality: '★★☆', available: true,
        desc: 'HTML 소스의 문서 구조를 옮기며, 웹 화면에서 복사한 일반 텍스트도 문단으로 보존합니다.',
        tech: 'DOMParser API → DOM 트리 순회 → IR → HWPX',
        features: [
            'h1~h6, p, ul/ol, table, blockquote, strong/em, code 등 문서형 태그 중심 지원',
            '밑줄, 취소선, 일부 글자색처럼 텍스트에 붙은 인라인 서식 일부 보존',
            '들여쓴 중첩 목록과 표의 rowspan/colspan 병합 구조 보존',
            '일반적으로 HTML 변환은 CSS 화면 배치보다 본문 의미 구조 보존이 우선',
        ],
        limits: ['웹 화면의 시각 배치와 CSS 레이아웃은 복제하지 않음', '이미지·SVG 미지원', 'script·style·nav·footer 등 비본문 요소 무시'],
    },
    docx: {
        icon: '📘', name: 'Word 문서 (DOCX)',
        quality: '★★☆', available: true,
        desc: 'Word 문서를 본문 구조 중심으로 재구성합니다. 내용 보존은 계속 강화 중이지만 원본 편집 화면을 그대로 복제하는 용도는 아닙니다.',
        tech: 'JSZip으로 압축 해제 → word/document.xml 본문·표 추출 → IR → HWPX',
        features: [
            '문서 순서 기준으로 제목 후보, 문단, 기본 표를 추출',
            '굵게/기울임/밑줄/취소선/글자색, 가운데·오른쪽 정렬 일부 보존',
            '표의 가로·세로 병합, 셀 배경색, 셀 글자색 일부 보존',
            'PNG/JPG/GIF/BMP 본문 이미지, 각주, 첫 머리글/바닥글 텍스트 일부 추출',
            '일반적으로 DOCX는 작성 도구별 세부 XML 차이가 있어 확인 작업이 필요',
        ],
        limits: ['원본 Word 페이지 배치·섹션·스타일 테마는 단순화', 'WMF/EMF 벡터 이미지 미지원', '주석·변경 추적·복잡한 개체와 일부 목록 번호는 손실 가능'],
    },
    hwp: {
        icon: '🇰🇷', name: '한글 문서 (HWP)',
        quality: '★☆☆', available: true, badge: '베타',
        desc: '구형 HWP는 브라우저에서 안정적으로 해석하기 어려운 베타 입력입니다. HWPX는 변환 대상이 아니라 한컴오피스에서 바로 열 수 있는 출력 형식입니다.',
        tech: 'ZIP 구조 시도 → 내부 XML/텍스트 추출 → IR',
        features: [
            'HWPX를 잘못 업로드한 경우 내부 XML 본문 텍스트와 일부 표를 읽을 수 있음',
            '구형 HWP5 바이너리는 결과 파일을 만들지 않고 HWPX/DOCX 재저장 방법을 안내',
            '일반적으로 한글 문서는 한컴오피스에서 HWPX로 저장하는 편이 가장 안전',
        ],
        limits: ['HWP5(바이너리) 본문 파싱은 대폭 제한됨', '서식·이미지·개체·복잡한 표 복원 불완전', '이미 HWPX인 파일은 변환보다 원본 사용을 권장'],
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
        desc: '서식이 없는 만큼 내용 누락 위험이 낮고, 문단 중심 HWPX 생성에 적합합니다.',
        tech: '줄바꿈 패턴 분석 → 문단 구분 → IR → HWPX',
        features: [
            '빈 줄로 문단 자동 구분',
            'UTF-8 / EUC-KR 인코딩 자동 감지',
            '한글·영문·특수문자와 일부 이모지 처리',
            '일반적으로 TXT는 서식보다 원문 텍스트 보존에 가장 유리',
        ],
        limits: ['제목·표·굵게 같은 서식 정보 없음', '표처럼 보이는 텍스트도 일반 문단으로 처리될 수 있음'],
    },
    csv: {
        icon: '📊', name: 'CSV / XLSX / 표 붙여넣기',
        quality: '★★☆', available: true,
        desc: '표 데이터의 행과 열을 HWPX 표로 옮기는 데 초점을 둔 입력 포맷입니다.',
        tech: 'CSV: RFC 4180 파서 / XLSX: SheetJS 라이브러리 → 표 IR → HWPX',
        features: [
            'CSV 전체 데이터, Excel·Google Sheets에서 복사한 탭 구분 표, XLSX 첫 번째 시트를 HWPX 표로 변환',
            '첫 행을 표 머리행으로 처리하고 기본 표 테두리 적용',
            '빈 셀, 긴 텍스트, 한글·영문·특수문자 처리',
            '일반적으로 스프레드시트 변환은 데이터 표 보존이 우선이고 시각 서식은 보조',
        ],
        limits: ['XLSX는 첫 번째 시트만 변환', '셀 병합·색상·폰트·차트·이미지 무시', '수식은 계산 결과값 중심으로 변환'],
    },
    json: {
        icon: '{ }', name: 'JSON 데이터',
        quality: '★★☆', available: true,
        desc: '데이터 구조를 사람이 읽는 문단·목록·표 형태로 펼쳐 쓰는 입력 포맷입니다.',
        tech: 'JSON.parse → 구조 분석 → IR → HWPX (IR 형식이면 직접 사용)',
        features: [
            '객체와 배열을 제목, 목록, 키-값 표 형태로 변환',
            '객체 배열은 키 합집합을 열로 사용하는 행형 표로 정리',
            'IR 형식 JSON을 직접 HWPX로 변환 가능 (고급 사용)',
            '일반적으로 JSON 변환은 원본 값 보존과 가독성 확보가 목표',
        ],
        limits: ['보고서형 편집 레이아웃을 자동 설계하지 않음', '깊은 중첩은 길게 펼쳐질 수 있음', '매우 큰 JSON(10MB+)은 처리 시간 증가'],
    },
    ipynb: {
        icon: '🔬', name: 'Jupyter Notebook (IPYNB)',
        quality: '★★☆', available: true,
        desc: '노트북의 설명, 코드, 텍스트 출력을 문서로 정리하는 용도에 맞춘 입력 포맷입니다.',
        tech: 'JSON 파싱 → cell_type별 처리(markdown/code/output) → IR → HWPX',
        features: [
            '마크다운 셀: 제목·표·코드블록 변환',
            '코드 셀: 등폭 코드블록으로 변환',
            '텍스트 출력 셀: 그대로 포함',
            '일반적으로 노트북 변환은 실행 가능한 노트북 보존이 아니라 읽는 문서화가 목표',
        ],
        limits: ['이미지 출력 셀(PNG/JPEG), 차트, 위젯 출력 미지원', 'LaTeX 수식과 실행 상태·메타데이터 미보존'],
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
        official: 'https://fonts.google.com/noto/specimen/Noto+Sans+KR?preview.script=Kore&preview.lang=ko_Kore',
    },
    {
        name: '나눔고딕',
        family: 'NanumGothic',
        systemNames: [
            '나눔고딕 보통', '나눔고딕', '나눔고딕 Regular', '나눔고딕OTF', '나눔고딕OTF Regular',
            'NanumGothic', 'NanumGothic Regular', 'NanumGothic-Regular', 'NanumGothicOTF', 'NanumGothicOTF Regular',
            'Nanum Gothic', 'Nanum Gothic Regular', 'Nanum Gothic-Regular', 'Nanum Gothic OTF', 'Nanum Gothic OTF Regular'
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
        name: 'Pretendard GOV Variable',
        family: 'Pretendard GOV Variable',
        systemNames: [
            'Pretendard GOV Variable', 'Pretendard GOV',
            'Pretendard GOV Variable Regular', 'Pretendard GOV Variable 보통',
            'Pretendard', 'Pretendard 보통', 'PretendardGOVVariable'
        ],
        desc: '오픈소스로 공개된 공공 라이선스 현대 고딕체입니다. 디지털 행정 문서에 잘 어울립니다.',
        local: ['fonts/PretendardGOVVariable.ttf'],
        official: 'https://github.com/orioncactus/pretendard/releases/tag/v1.3.9',
    },
];

/** 포맷 카드 클릭 → 상세 정보 팝업 표시 */
function initFormatCards() {
    document.querySelectorAll('.format-card').forEach(card => {
        decorateFormatCard(card);
        const openCard = () => {
            const ext = card.dataset.ext || '';
            if (ext) openFormatModal(ext);
        };
        card.addEventListener('click', openCard);
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openCard();
            }
        });
    });

    document.getElementById('close-format-modal')
        ?.addEventListener('click', closeFormatModal);
    document.getElementById('format-modal')
        ?.addEventListener('click', e => {
            if (e.target.id === 'format-modal') closeFormatModal();
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

    openModal(modal);
}

function closeFormatModal() {
    closeModal(document.getElementById('format-modal'));
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
    const norm = s => String(s || '').toLowerCase().replace(/[\s_\-()]+/g, '');
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
    // 3) 폴백: FontFace local() — 설치된 시스템 폰트 이름만 확인한다.
    for (const name of names) {
        try {
            const font = new FontFace('__detect__', `local("${name}")`);
            await font.load();
            return true;
        } catch (_) {}
    }
    return false;
}

function normalizeFontRegistrationName(value) {
    return String(value || '').toLowerCase().replace(/[\s_\-()]+/g, '');
}

function hasExactLocalFontName(localFontsList, name) {
    const target = normalizeFontRegistrationName(name);
    return Array.from(localFontsList || []).some(font =>
        [font.family, font.fullName, font.postscriptName]
            .some(value => normalizeFontRegistrationName(value) === target));
}

async function canLoadExactLocalFont(name) {
    try {
        const font = new FontFace('__tohwpx_exact_font__', `local("${name}")`);
        await font.load();
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Pretendard GOV Variable 선택 시 현재 PC의 실제 등록명을 HWPX 주 글꼴명으로 결정한다.
 * queryLocalFonts가 허용되면 정확한 등록명을 우선하고, 미지원/거부 시 local()로 보조 감지한다.
 * 둘 다 판별할 수 없으면 배포 TTF의 내부 패밀리명인 Variable을 기본값으로 사용한다.
 */
async function resolveOutputFontName(selectedName, localFontsOverride) {
    if (selectedName !== 'Pretendard GOV Variable') return selectedName;

    let localFontsList = localFontsOverride;
    if (localFontsList === undefined && 'queryLocalFonts' in window) {
        try { localFontsList = await window.queryLocalFonts(); } catch (_) { localFontsList = null; }
    }

    if (localFontsList !== null && localFontsList !== undefined) {
        if (hasExactLocalFontName(localFontsList, 'Pretendard GOV Variable')) return 'Pretendard GOV Variable';
        if (hasExactLocalFontName(localFontsList, 'Pretendard GOV')) return 'Pretendard GOV';
        return 'Pretendard GOV Variable';
    }

    if (await canLoadExactLocalFont('Pretendard GOV Variable')) return 'Pretendard GOV Variable';
    if (await canLoadExactLocalFont('Pretendard GOV')) return 'Pretendard GOV';
    return 'Pretendard GOV Variable';
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
        const official = `<a class="font-official-link" href="${escHtml(font.official)}" target="_blank" rel="noopener">공식 사이트</a>`;
        if (isInstalled) {
            box.innerHTML = `<span class="font-installed-badge">설치됨 ✓</span>${official}`;
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
    openModal(modal);
    renderFontGuide();
}

function closeFontGuide() {
    closeModal(document.getElementById('font-guide-modal'));
}


// ─────────────────────────────────────────────────────────────────────────
// [옵션 패널]
//   상단 제목 블록(없음/넣기) + 사용자 지정 제목 + IR 미리보기 토글
// ─────────────────────────────────────────────────────────────────────────
function initOptions() {
    // 상단 제목 블록 선택 (라디오 카드: plain/titleblock/cover-unit/cover-annual)
    document.querySelectorAll('input[name="doc-type"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.checked) state.docType = radio.value;
        });
    });

    // 사용자 지정 제목 입력
    const titleEl = document.getElementById('doc-title');
    if (titleEl) {
        titleEl.addEventListener('input', () => {
            state.customTitle = titleEl.value.trim();
        });
    }

    // 제목을 비웠을 때 적용할 기준 (문서 첫 제목/문장 또는 파일 이름)
    const titleSrcEl = document.getElementById('title-source');
    if (titleSrcEl) {
        updateTitlePlaceholder(titleSrcEl.value);
        titleSrcEl.addEventListener('change', () => {
            state.titleSource = titleSrcEl.value;
            updateTitlePlaceholder(titleSrcEl.value);
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

    // 용지 방향 세그먼트(세로/가로) — .seg-btn[data-orient]
    const orientBtns = document.querySelectorAll('.seg-btn[data-orient]');
    if (orientBtns.length) {
        const savedOrient = localStorage.getItem('tohwpx_orientation');
        if (savedOrient === 'landscape') state.orientation = 'landscape';
        applyOrientationUi(state.orientation);
        orientBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                state.orientation = btn.dataset.orient === 'landscape' ? 'landscape' : 'portrait';
                applyOrientationUi(state.orientation);
                localStorage.setItem('tohwpx_orientation', state.orientation);
            });
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

function updateTitlePlaceholder(titleSource = state.titleSource) {
    const titleEl = document.getElementById('doc-title');
    if (!titleEl) return;
    titleEl.placeholder = titleSource === 'filename'
        ? '비워두면 파일 이름을 제목으로 씁니다'
        : '비워두면 문서에서 제목을 찾습니다';
}


// ─────────────────────────────────────────────────────────────────────────
// [변환 버튼 + Ctrl/⌘+Enter 단축키]
// ─────────────────────────────────────────────────────────────────────────
function initConvertButton() {
    const btn = document.getElementById('convert-btn');
    if (!btn) return;
    btn.addEventListener('click', triggerConvert);

    // Ctrl+Enter (Windows/Linux) / ⌘+Enter (Mac) 단축키로 변환 시작
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            triggerConvert();
        }
    });
}

/** 현재 입력 방식(파일/직접 입력)에 맞춰 변환을 시작한다 */
function triggerConvert() {
    if (state.isConverting) return;
    if (state.inputMode === 'paste') {
        runPasteConversion();
        return;
    }
    if (!state.queue.length) return;
    syncMarginInputs();
    runConversionPipeline();
}


// ─────────────────────────────────────────────────────────────────────────
// [직접 입력 모드]
//   파일 업로드 대신 텍스트(MD/HTML/TXT/CSV/JSON)를 붙여넣어 변환한다.
//   붙여넣은 텍스트를 가짜 File로 감싸 기존 큐/파이프라인(길이 1)을 그대로 재사용.
// ─────────────────────────────────────────────────────────────────────────
const PASTE_MIME = {
    md:   'text/markdown',
    html: 'text/html',
    txt:  'text/plain',
    csv:  'text/csv',
    json: 'application/json',
};

function initInputMode() {
    document.getElementById('mode-upload')?.addEventListener('click', () => setInputMode('upload'));
    document.getElementById('mode-paste')?.addEventListener('click', () => setInputMode('paste'));

    // 입력 형식 선택 — 저장값 복원 + 보존/손실 안내 갱신
    const fmt = document.getElementById('paste-format');
    if (fmt) {
        const saved = localStorage.getItem('tohwpx_pasteFormat');
        if (saved && Array.from(fmt.options).some(o => o.value === saved)) fmt.value = saved;
        fmt.addEventListener('change', () => {
            localStorage.setItem('tohwpx_pasteFormat', fmt.value);
            updatePasteFormatHelp(fmt.value);
            if (state.inputMode === 'paste') updateFormatExpectation(fmt.value);
        });
        updatePasteFormatHelp(fmt.value);
    }

    // 텍스트 입력 시 변환 버튼 활성/비활성
    const ta = document.getElementById('paste-input');
    ta?.addEventListener('input', () => {
        if (state.inputMode !== 'paste' || state.isConverting) return;
        const hasText = !!ta.value.trim();
        updateConvertButton(hasText);
        if (hasText) setProgressPanelState('ready');
    });
}

function updatePasteFormatHelp(ext) {
    const help = document.getElementById('paste-format-help');
    if (!help) return;
    const messages = {
        md: 'Markdown 문법의 제목·목록·표·강조·코드·인용구를 인식합니다.',
        html: 'HTML 소스를 붙여넣으세요. 웹 화면에서 복사한 일반 텍스트도 문단으로 보존됩니다.',
        txt: '입력한 텍스트와 빈 줄 기준 문단을 그대로 변환합니다.',
        csv: '쉼표 CSV와 Excel·Google Sheets에서 복사한 탭 구분 표를 자동 인식합니다.',
        json: '유효한 JSON 또는 To HWPX IR 구조를 입력하세요.',
    };
    help.textContent = messages[ext] || '';
}

/** 입력 방식 전환 (파일 ↔ 직접 입력). 전환 시 진행 중 입력은 초기화한다. */
function setInputMode(mode) {
    if (mode !== 'upload' && mode !== 'paste') return;
    if (mode === state.inputMode) return;
    if (state.isConverting) return;   // 변환 중에는 전환 금지

    state.inputMode = mode;

    const upload = document.getElementById('upload-mode');
    const paste  = document.getElementById('paste-mode');
    if (upload) upload.hidden = mode !== 'upload';
    if (paste)  paste.hidden  = mode !== 'paste';

    const tabU = document.getElementById('mode-upload');
    const tabP = document.getElementById('mode-paste');
    tabU?.classList.toggle('is-active', mode === 'upload');
    tabP?.classList.toggle('is-active', mode === 'paste');
    tabU?.setAttribute('aria-selected', String(mode === 'upload'));
    tabP?.setAttribute('aria-selected', String(mode === 'paste'));

    // 공통 초기화(큐·결과·업로드 UI). clearSelectedFile은 inputMode를 바꾸지 않는다.
    clearSelectedFile();

    if (mode === 'paste') {
        const ta  = document.getElementById('paste-input');
        const fmt = document.getElementById('paste-format');
        if (fmt) updateFormatExpectation(fmt.value);   // 선택 형식의 보존/손실 안내 표시
        const hasText = !!ta?.value.trim();
        updateConvertButton(hasText);
        if (hasText) setProgressPanelState('ready');
        ta?.focus();
    }
}

/** 직접 입력 텍스트를 가짜 File로 감싸 단일 변환을 실행 */
function runPasteConversion() {
    if (state.isConverting) return;
    const ta = document.getElementById('paste-input');
    const text = ta ? ta.value : '';
    if (!text.trim()) {
        showToast('<strong>입력 내용이 비어 있습니다</strong> <span>변환할 내용을 입력해 주세요.</span>', { timeout: 4000 });
        ta?.focus();
        return;
    }
    const ext  = document.getElementById('paste-format')?.value || 'md';
    const mime = PASTE_MIME[ext] || 'text/plain';
    const baseName = sanitizeBaseName(document.getElementById('paste-name')?.value) || '문서';
    // 붙여넣은 텍스트를 가짜 File로 감싸면 fileToIR이 확장자로 형식을 인식한다
    const file = new File([text], `${baseName}.${ext}`, { type: mime });

    syncMarginInputs();
    revokeAllQueueUrls();   // 재변환 시 이전 결과 URL 정리(큐 교체 전)
    state.file = file;
    state.queue = [{
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        file, ext,
        status: 'pending', blob: null, url: null, fileName: null, validation: null, error: null,
    }];
    runConversionPipeline();
}

/** 문서명 입력값에서 경로/제어문자·끝 확장자를 제거해 안전한 베이스 이름으로 */
function sanitizeBaseName(raw) {
    return String(raw || '')
        .replace(/[\\/:*?"<>|]/g, '')   // 경로 금지 문자(공백·하이픈 유지)
        .replace(/\.(hwpx|md|html?|txt|csv|json|ipynb|docx|xlsx?|hwp)$/i, '')  // 끝 확장자 제거
        .trim()
        .slice(0, 100);
}

function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const ae = document.activeElement;
        const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
        if (e.key === '?' && !typing) {
            e.preventDefault();
            showShortcuts();
            return;
        }

        // Shift + D — 다크/라이트 테마 전환.
        // (Ctrl/⌘ + D 브라우저 즐겨찾기와 겹치지 않게 다른 수정자는 모두 제외)
        if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
            && e.key.toLowerCase() === 'd' && !typing) {
            e.preventDefault();
            toggleTheme();
            return;
        }

        if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o')) return;
        const modalOpen = !!document.querySelector('.modal-overlay.open');
        if (modalOpen) return;
        if (typing) return;
        e.preventDefault();
        document.getElementById('file-input')?.click();
    });
}

/** 변환 버튼 활성/비활성 상태 및 텍스트 변경 */
function updateConvertButton(enabled) {
    const btn = document.getElementById('convert-btn');
    if (!btn) return;
    btn.disabled = !enabled;
    const n = state.queue.length;
    if (state.inputMode === 'paste') {
        btn.textContent = !enabled
            ? (state.isConverting ? '변환 중…' : '내용을 입력하세요')
            : '변환 시작 →';
    } else {
        btn.textContent = !enabled
            ? (state.isConverting ? '변환 중…' : '파일을 먼저 선택하세요')
            : (n > 1 ? `${n}개 변환 시작 →` : '변환 시작 →');
    }
}


// ─────────────────────────────────────────────────────────────────────────
// [핵심: 7단계 변환 파이프라인 실행]
//   비동기(async) 함수 — 각 단계가 순차적으로 실행되며 UI에 진행 상태 표시
// ─────────────────────────────────────────────────────────────────────────
async function runConversionPipeline() {
    if (!state.queue.length || state.isConverting) return;

    state.isConverting = true;
    setProgressPanelState('converting');
    hideResult();
    hideAlert();
    updateConvertButton(false);
    revokeAllQueueUrls();          // 이전 변환 결과 URL 정리
    renderQueueList();             // 변환 중에는 제거/비우기 버튼 숨김

    // 변환 시작 시 진행 패널이 보이도록 스크롤
    document.querySelector('.progress-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const total = state.queue.length;
    const batch = total > 1;
    const outputFontName = await resolveOutputFontName(state.docFont);
    let okCount = 0, warnCount = 0, errCount = 0;

    // 큐를 순차 처리 — 실패해도 다음 파일을 계속 변환(부분 성공 허용)
    for (let i = 0; i < total; i++) {
        const item = state.queue[i];
        item.status = 'converting';
        if (batch) renderQueueList();
        resetPipeline();

        const prefix = batch ? `(${i + 1}/${total}) ${item.file.name} · ` : '';
        try {
            const res = await convertOneFile(item.file, prefix, outputFontName);
            item.blob = res.blob;
            item.fileName = res.fileName;
            item.validation = res.validation;
            item.url = URL.createObjectURL(res.blob);
            item.status = res.validation.pass ? 'done' : 'warn';
            if (res.validation.pass) okCount++; else warnCount++;
        } catch (err) {
            item.status = 'error';
            item.error = err;
            errCount++;
            console.error('[To HWPX] 변환 오류:', item.file.name, err);
        }
        if (batch) renderQueueList();
    }

    setProgress(100);

    if (!batch) {
        // ── 단일 파일: 기존 동작 유지(결과 카드 1개 + 자동 다운로드) ──
        const item = state.queue[0];
        if (item.status === 'error') {
            setProgressPanelState('error');
            setStatusText('실패');
            showFailureResult(item.error);
            const failure = classifyConversionError(item.error, item.ext);
            showAlert(`${failure.title}\n다음 행동: ${failure.action}`);
        } else {
            state.file = item.file;
            state.hwpxBlob = item.blob;
            state.downloadUrl = item.url;   // 미리보기 fallback 등 단일 참조 호환
            state.downloadTimer = setTimeout(revokeAllQueueUrls, 300_000);
            setProgressPanelState(item.validation.pass ? 'success' : 'warning');
            setStatusText('완료!');
            showResult({ url: item.url, fileName: item.fileName, size: item.blob.size, validation: item.validation });
            if (state.autoDownload && item.validation.pass) {
                triggerDownload(item.url, item.fileName);
                setStatusText('완료! 다운로드를 시작했습니다.');
            } else if (!item.validation.pass) {
                setStatusText('완료했지만 구조 경고가 있어 자동 다운로드를 중지했습니다.');
            }
        }
    } else {
        // ── 배치: 파일별 결과 목록 + 전체 ZIP ──
        const anyOk = (okCount + warnCount) > 0;
        setProgressPanelState(!anyOk ? 'error' : (warnCount || errCount ? 'warning' : 'success'));
        setStatusText(`완료 — 성공 ${okCount} · 경고 ${warnCount} · 실패 ${errCount}`);
        showBatchResults({ okCount, warnCount, errCount, total });
        state.downloadTimer = setTimeout(revokeAllQueueUrls, 300_000);
        // 배치는 N회 자동 다운로드 대신 ZIP 1회만 자동 다운로드(자동 다운로드 켜진 경우)
        if (state.autoDownload && anyOk && warnCount === 0) {
            await downloadAllAsZip();
        }
    }

    state.isConverting = false;
    updateConvertButton(state.queue.length > 0);
    renderQueueList();   // 변환 종료 후 목록 갱신(편집 버튼 복귀)
}

/**
 * 파일 1개를 7단계 파이프라인으로 변환하고 결과를 반환한다.
 * 진행 표시는 "현재 파일" 기준으로 갱신(배치에선 statusPrefix로 "(i/n) 파일명" 표기).
 * @param {File} file
 * @param {string} statusPrefix
 * @param {string} outputFontName 현재 PC 등록명으로 해석한 실제 HWPX 글꼴명
 * @returns {Promise<{blob: Blob, fileName: string, validation: object}>}
 */
async function convertOneFile(file, statusPrefix = '', outputFontName = state.docFont) {
    const st = (msg) => setStatusText(statusPrefix + msg);
    state.file = file;
    state.ir = null;
    state.hwpxBlob = null;

    // ═══ 1단계: Ingest (파일 읽기 준비) ═══
    setStepState('ingest', 'active');
    setProgress(8);
    await tick();  // UI 업데이트를 위한 이벤트 루프 양보
    setStepState('ingest', 'done');

    // ═══ 2단계: Normalize (포맷 파서로 IR 변환) ═══
    setStepState('normalize', 'active');
    setProgress(25);
    st('파일을 분석하는 중...');

    let ir;
    try {
        ir = await fileToIR(file, state.docType);
    } catch (e) {
        throw new Error('파일 파싱 실패: ' + e.message);
    }

    // 제목: 단일일 때만 직접 입력(customTitle) 적용, 배치는 파일별 자동 기준 규칙
    const customTitle = state.queue.length === 1 ? state.customTitle : '';
    applyDocumentTitlePolicy(ir, file, customTitle, state.titleSource);
    state.ir = ir;

    // [보안] IR 미리보기는 textContent로만 표시 (innerHTML 사용 금지)
    updateIrPreview(ir);
    setStepState('normalize', 'done');
    setProgress(42);

    // ═══ 3단계: Generate (HWPX 생성) ═══
    setStepState('generate', 'active');
    setProgress(58);
    st('HWPX 파일을 생성하는 중...');
    await tick();

    let hwpxBlob;
    try {
        hwpxBlob = await buildHwpx(ir, outputFontName, state.fontSize, state.pageMargins, state.paperSize, (pct) => {
            setProgress(58 + (pct * 0.14)); // 58% ~ 72%
            st(`HWPX 파일을 압축하는 중... ${Math.round(pct)}%`);
        }, state.orientation);
    } catch (e) {
        throw new Error('HWPX 생성 실패: ' + e.message);
    }
    setStepState('generate', 'done');

    // ═══ 4단계: Validate (4영역 구조 검증) ═══
    setStepState('validate', 'active');
    setProgress(72);
    st('HWPX 구조를 검증하는 중...');

    let validation;
    try {
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
    st('다운로드를 준비하는 중...');
    await tick();
    const fileName = `${file.name.replace(/\.[^.]+$/, '')}.hwpx`;
    setStepState('ship', 'done');
    setProgress(100);

    return { blob: finalBlob, fileName, validation };
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
    const officeCheckTitle = validation.pass ? '한컴오피스 최종 확인 권장' : '한컴오피스 확인 필수';
    const officeCheckDetail = validation.pass
        ? '글꼴·여백·표 너비는 미리보기와 다를 수 있습니다.'
        : '구조 검증 경고가 있어 한컴오피스에서 반드시 열어 확인하세요.';

    // 검증 결과에 따른 표시 텍스트
    const validText = validation.pass
        ? '주요 구조 검증 PASS — 한글 호환 패키지 조건 충족'
        : `구조 검증 경고 ${issues.length || 1}건 — 다운로드 전 미리보기를 확인하세요`;
    const validClass = validation.pass ? 'result-valid' : 'result-warn';
    const cardClass = validation.pass ? '' : ' result-card--warn';
    const autoText = state.autoDownload && validation.pass
        ? '자동 다운로드가 시작되었습니다. 필요하면 다시 다운로드하거나 미리보기를 여세요.'
        : !validation.pass
            ? '구조 검증 경고로 자동 다운로드를 중지했습니다. 경고를 확인한 뒤 필요할 때만 수동으로 내려받으세요.'
        : '자동 다운로드가 꺼져 있습니다. 아래 버튼으로 내려받으세요.';

    // [보안] URL은 blob: 스킴만 가능 (직접 생성했으므로 안전)
    //         escHtml()로 fileName을 이스케이프하여 XSS 방지
    area.innerHTML = `
        <div class="result-card${cardClass}">
            <div class="result-topline">
                <div class="result-file-row">
                    <span class="result-file-icon">📄</span>
                    <div class="result-file-info">
                        <strong>${escHtml(fileName)}</strong>
                        <span class="result-file-size">${formatBytes(size)} · 입력 ${escHtml(inputLabel)}</span>
                        <span class="result-download-location">
                            저장 위치: 브라우저 기본 다운로드 폴더
                            <small>설정에 따라 달라질 수 있습니다</small>
                        </span>
                    </div>
                </div>
                <div class="result-actions">
                    <a id="download-link"
                       href="${url}"
                       download="${escHtml(fileName)}"
                       type="application/hwp+zip"
                       class="btn-download btn-download-primary">
                        ⬇ HWPX 다운로드
                    </a>
                    <button class="btn-preview" id="preview-result-btn">
                        👁 미리보기
                    </button>
                </div>
            </div>
            <div class="result-validation ${validClass}">
                <span class="result-validation-mark">${validation.pass ? '✓' : '!'}</span>
                <span>${escHtml(validText)}</span>
            </div>
            <div class="result-trust-list" aria-label="산출물 신뢰도 요약">
                <span class="${validation.pass ? 'trust-ok' : 'trust-warn'}"><b>검증</b>${validation.pass ? '패키지 구조 통과' : '구조 확인 필요'}</span>
                <span class="trust-info"><b>처리</b>브라우저 내부</span>
                <span class="trust-info"><b>링크</b>5분 유지</span>
            </div>
            ${issuePreview.length ? `
                <ul class="result-issues">
                    ${issuePreview.map(issue => `<li>${escHtml(issue)}</li>`).join('')}
                    ${issues.length > issuePreview.length ? `<li>외 ${issues.length - issuePreview.length}건</li>` : ''}
                </ul>
            ` : ''}
            <dl class="result-summary">
                <div><dt>변환된 파일명</dt><dd>${escHtml(fileName)}</dd></div>
                <div><dt>입력 포맷</dt><dd>${escHtml(inputLabel)}</dd></div>
                <div><dt>보존된 요소</dt><dd>${escHtml(summary.preserved)}</dd></div>
                <div><dt>제외/손실된 요소</dt><dd>${escHtml(summary.lossy)}</dd></div>
            </dl>
            <div class="result-office-note">
                <strong>${escHtml(officeCheckTitle)}</strong>
                <span>${escHtml(officeCheckDetail)}</span>
            </div>
            <p class="result-note">${escHtml(autoText)}</p>
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

/** 배치 변환 결과 — 파일별 행 목록 + 전체 ZIP 다운로드 버튼 */
function showBatchResults({ okCount, warnCount, errCount, total }) {
    const area = document.getElementById('result-area');
    if (!area) return;

    const successCount = okCount + warnCount;
    const cardClass = (errCount && !successCount) ? ' result-card--error'
        : ((warnCount || errCount) ? ' result-card--warn' : '');

    const rows = state.queue.map(item => {
        if (item.status === 'error') {
            const failure = classifyConversionError(item.error, item.ext);
            return `
                <li class="batch-row batch-row--error" data-id="${item.id}">
                    <span class="batch-row-icon">⚠️</span>
                    <div class="batch-row-main">
                        <strong class="batch-row-name">${escHtml(item.file.name)}</strong>
                        <span class="batch-row-meta">실패 · ${escHtml(failure.category)} — ${escHtml(failure.action)}</span>
                    </div>
                    <span class="batch-row-status batch-status--err">실패</span>
                </li>
            `;
        }
        const warn = item.status === 'warn';
        const inputLabel = getInputFormatLabel(item.ext);
        return `
            <li class="batch-row" data-id="${item.id}">
                <span class="batch-row-icon">${warn ? '⚠️' : '✅'}</span>
                <div class="batch-row-main">
                    <strong class="batch-row-name">${escHtml(item.fileName)}</strong>
                    <span class="batch-row-meta">${formatBytes(item.blob.size)} · 입력 ${escHtml(inputLabel)}${warn ? ' · 구조 확인 필요' : ''}</span>
                </div>
                <div class="batch-row-actions">
                    <button type="button" class="batch-preview" data-id="${item.id}">👁 미리보기</button>
                    <a class="batch-download" href="${item.url}" download="${escHtml(item.fileName)}" type="application/hwp+zip">⬇ 받기</a>
                </div>
                <span class="batch-row-status ${warn ? 'batch-status--warn' : 'batch-status--ok'}">${warn ? '경고' : '완료'}</span>
            </li>
        `;
    }).join('');

    area.innerHTML = `
        <div class="result-card${cardClass}">
            <div class="batch-result-head">
                <div class="batch-result-title">
                    <strong>배치 변환 완료 — ${total}개 중 성공 ${okCount} · 경고 ${warnCount} · 실패 ${errCount}</strong>
                    <span>각 파일은 개별 HWPX로 변환되었습니다. 한컴오피스에서 최종 확인을 권장합니다.</span>
                </div>
                ${successCount ? `<button type="button" id="batch-zip-btn" class="btn-download btn-download-primary">⬇ 전체 ZIP 다운로드 (${successCount})</button>` : ''}
            </div>
            <ul class="batch-result-list">${rows}</ul>
            <div class="result-download-location">
                저장 위치: 브라우저 기본 다운로드 폴더
                <small>설정에 따라 달라질 수 있습니다 · 다운로드 링크는 5분간 유지됩니다</small>
            </div>
        </div>
    `;
    area.style.display = 'block';

    area.querySelector('#batch-zip-btn')?.addEventListener('click', downloadAllAsZip);
    area.querySelectorAll('.batch-preview').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = state.queue.find(q => q.id === btn.dataset.id);
            if (!item || !item.blob) return;
            // 미리보기는 단일 참조를 사용하므로 선택 항목으로 맞춘다
            state.file = item.file;
            state.hwpxBlob = item.blob;
            state.downloadUrl = item.url;
            openPreview(item.blob);
        });
    });
    area.querySelectorAll('.batch-download').forEach(a => {
        a.addEventListener('click', () => {
            const ind = document.getElementById('dl-indicator');
            if (ind) { ind.hidden = false; setTimeout(() => { ind.hidden = true; }, 2800); }
        });
    });
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** 성공/경고 결과 blob들을 JSZip으로 묶어 한 번에 다운로드 */
async function downloadAllAsZip() {
    if (typeof JSZip === 'undefined') {
        showToast('<strong>ZIP 라이브러리를 불러오지 못했습니다</strong> <span>파일별 받기 버튼을 이용해 주세요.</span>', { timeout: 6000 });
        return;
    }
    const ready = state.queue.filter(q => q.blob && (q.status === 'done' || q.status === 'warn'));
    if (!ready.length) return;

    const ind = document.getElementById('dl-indicator');
    if (ind) ind.hidden = false;
    try {
        const zip = new JSZip();
        const used = new Set();
        for (const item of ready) {
            zip.file(uniqueZipName(item.fileName, used), item.blob);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `변환결과_${ymdStamp()}.zip`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
        console.error('[To HWPX] ZIP 생성 오류:', e);
        showToast('<strong>ZIP 생성 중 오류가 발생했습니다</strong> <span>파일별 받기 버튼을 이용해 주세요.</span>', { timeout: 6000 });
    } finally {
        if (ind) setTimeout(() => { ind.hidden = true; }, 1200);
    }
}

/** ZIP 내 중복 파일명을 'name (2).hwpx'로 유일화 */
function uniqueZipName(fileName, used) {
    const name = normalizeHwpxFileName(fileName);
    if (!used.has(name)) { used.add(name); return name; }
    const base = name.replace(/\.hwpx$/i, '');
    let i = 2;
    while (used.has(`${base} (${i}).hwpx`)) i++;
    const unique = `${base} (${i}).hwpx`;
    used.add(unique);
    return unique;
}

/** YYYYMMDD 날짜 스탬프 (ZIP 파일명용) */
function ymdStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function showFailureResult(err) {
    const area = document.getElementById('result-area');
    if (!area) return;
    const ext = state.file ? getFileExtension(state.file.name) : '';
    const failure = classifyConversionError(err, ext);
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

function formatSpecificRecovery(ext) {
    const map = {
        docx: 'Word에서 파일을 다시 저장한 뒤 시도하세요. 표·이미지가 복잡하면 DOCX를 단순화하거나 한컴에서 직접 HWPX로 저장해 보세요.',
        hwp: 'HWP는 베타 입력입니다. 한컴오피스에서 HWPX 또는 DOCX로 다시 저장한 파일을 사용하면 성공 가능성이 높습니다.',
        hwpx: '이미 HWPX인 파일은 변환보다 원본 사용을 권장합니다. 복구가 목적이면 한컴에서 열리는지 먼저 확인하세요.',
        json: 'JSON 문법 오류가 없는지 확인하고, 너무 깊은 중첩이나 큰 배열은 나누어 변환해 보세요.',
        ipynb: '노트북 JSON 구조가 깨지지 않았는지 확인하고, 이미지·차트 출력이 많다면 Markdown 또는 DOCX로 내보낸 뒤 변환해 보세요.',
        xlsx: '첫 번째 시트만 변환됩니다. 필요한 시트를 맨 앞으로 옮기고, 병합 셀·차트·이미지를 줄인 뒤 다시 시도하세요.',
        xls: '가능하면 XLSX로 다시 저장하고, 필요한 시트를 맨 앞으로 옮긴 뒤 다시 시도하세요.',
        csv: '구분자와 따옴표가 깨지지 않았는지 확인하고, Excel에서 CSV UTF-8로 다시 저장해 보세요.',
        md: 'Markdown 문법을 단순화하고, 복잡한 인라인 HTML이나 이미지가 많으면 제거한 뒤 다시 시도하세요.',
        markdown: 'Markdown 문법을 단순화하고, 복잡한 인라인 HTML이나 이미지가 많으면 제거한 뒤 다시 시도하세요.',
        html: '본문만 남긴 HTML로 다시 저장해 보세요. script, style, 외부 리소스, 복잡한 CSS 레이아웃은 변환 대상이 아닙니다.',
        htm: '본문만 남긴 HTML로 다시 저장해 보세요. script, style, 외부 리소스, 복잡한 CSS 레이아웃은 변환 대상이 아닙니다.',
        txt: '파일 인코딩을 UTF-8 또는 EUC-KR로 다시 저장한 뒤 시도하세요.',
        text: '파일 인코딩을 UTF-8 또는 EUC-KR로 다시 저장한 뒤 시도하세요.',
    };
    return map[ext] || '파일을 다시 저장한 뒤 재시도하고, 계속 실패하면 더 단순한 입력 포맷(TXT, MD, DOCX)으로 변환해 보세요.';
}

function classifyConversionError(err, ext = '') {
    const msg = String(err?.message || err || '');
    const recovery = formatSpecificRecovery(ext);
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
            action: `${recovery} 문서가 크다면 나누거나 이미지·불필요한 시트를 줄여 주세요.`,
        };
    }
    if (/파싱|parse|JSON|ZIP|로드 실패|손상|압축/i.test(msg)) {
        return {
            category: '파싱 오류',
            title: '파일 내용을 읽는 중 문제가 생겼습니다.',
            reason: msg,
            action: recovery,
        };
    }
    if (/HWP5|바이너리|구조|검증|미지원|unsupported structure/i.test(msg)) {
        return {
            category: '지원하지 않는 구조',
            title: '파일 안의 일부 구조를 변환할 수 없습니다.',
            reason: msg,
            action: recovery,
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
        action: recovery,
    };
}

function getInputFormatLabel(ext) {
    const info = getFormatInfoForExt(ext);
    return info ? `${info.name} (.${String(ext || '').toUpperCase()})` : `.${String(ext || '').toUpperCase()}`;
}

function getConversionSummaryForExt(ext) {
    const summaries = {
        md: {
            preserved: '제목, 문단, 목록, 표, 코드블록, 링크 텍스트',
            lossy: '이미지, 복잡한 HTML, 사용자 정의 스타일, 페이지 배치',
        },
        markdown: {
            preserved: '제목, 문단, 목록, 표, 코드블록, 링크 텍스트',
            lossy: '이미지, 복잡한 HTML, 사용자 정의 스타일, 페이지 배치',
        },
        html: {
            preserved: 'h1-h6, p, 중첩 ul/ol, 병합 표, strong/em/u/s, 일부 글자색과 태그 없는 일반 텍스트',
            lossy: '웹 화면 배치, CSS 레이아웃, 이미지, SVG, 스크립트, 외부 리소스',
        },
        htm: {
            preserved: 'h1-h6, p, ul/ol, table, strong/em 중심 구조',
            lossy: 'CSS 레이아웃, 이미지, SVG, 스크립트, 외부 리소스',
        },
        docx: {
            preserved: '본문, 제목 후보, 기본 표, 일부 인라인 서식과 이미지',
            lossy: 'Word 레이아웃, 스타일 테마, 주석, 변경 추적, 복잡한 개체',
        },
        txt: {
            preserved: '원문 텍스트, 줄바꿈, 빈 줄 기준 문단',
            lossy: '제목 구조, 표 구조, 굵게/색상 같은 서식 정보',
        },
        text: {
            preserved: '원문 텍스트, 줄바꿈, 빈 줄 기준 문단',
            lossy: '제목 구조, 표 구조, 굵게/색상 같은 서식 정보',
        },
        csv: {
            preserved: 'CSV·탭 구분 표의 행/열, 빈 셀, 첫 행 머리글, 긴 텍스트',
            lossy: '셀 병합, 수식 자체, 색상, 차트, 이미지, 여러 시트',
        },
        xlsx: {
            preserved: '첫 번째 시트의 행/열, 빈 셀, 첫 행 머리글',
            lossy: '여러 시트, 수식 자체, 차트, 이미지, 셀 병합과 세부 서식',
        },
        xls: {
            preserved: '첫 번째 시트의 행/열, 빈 셀, 첫 행 머리글',
            lossy: '여러 시트, 수식 자체, 차트, 이미지, 셀 병합과 세부 서식',
        },
        json: {
            preserved: '객체/배열 값, 키-값 표, 객체 배열의 행형 표, 정규화된 IR',
            lossy: '보고서형 레이아웃, 데이터 타입 의미, 원본 들여쓰기',
        },
        ipynb: {
            preserved: '마크다운 셀, 코드 셀, 텍스트 출력',
            lossy: '실행 상태, 이미지/차트 출력, 위젯, 수식, 메타데이터',
        },
        hwp: {
            preserved: 'HWPX 오업로드 시 XML 텍스트와 일부 표',
            lossy: 'HWP5 본문, 이미지, 개체, 복잡한 한글 서식',
        },
        hwpx: {
            preserved: '이미 HWPX이므로 원본 사용 권장, 필요 시 텍스트 일부 재구성',
            lossy: '재변환 시 원본 스타일, 이미지, 개체, 세밀한 레이아웃',
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

/** 단일/배치 모든 결과 Blob URL과 타이머를 해제(메모리 누수·개인정보 보호) */
function revokeAllQueueUrls() {
    revokeDownloadUrl();
    for (const item of state.queue) {
        if (item.url) {
            URL.revokeObjectURL(item.url);
            item.url = null;
        }
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
    document.querySelectorAll('.seg-btn[data-orient]').forEach(btn => {
        const active = (btn.dataset.orient === 'landscape') === landscape;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
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

    panel.hidden = stateName === 'empty';
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
        toggle.setAttribute('aria-label', isOpen ? '메뉴 닫기' : '메뉴 열기');
        toggle.textContent = isOpen ? '✕' : '☰';
    });

    // 메뉴 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        if (!nav.contains(e.target) && !toggle.contains(e.target)) {
            nav.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-label', '메뉴 열기');
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
                const menuToggle = document.getElementById('menu-toggle');
                if (menuToggle) {
                    menuToggle.setAttribute('aria-expanded', 'false');
                    menuToggle.setAttribute('aria-label', '메뉴 열기');
                    menuToggle.textContent = '☰';
                }
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
function getModalFocusable(modal) {
    return Array.from(modal.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hidden && el.getClientRects().length > 0);
}

function openModal(modal) {
    if (!modal) return;
    const active = document.querySelector('.modal-overlay.open');
    if (active && active !== modal) closeModal(active, false);
    modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal.classList.add('open');
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => {
        const focusTarget = getModalFocusable(modal)[0] || modal;
        if (focusTarget === modal && !modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
        focusTarget.focus({ preventScroll: true });
    });
}

function closeModal(modal, restoreFocus = true) {
    if (!modal || !modal.classList.contains('open')) return;
    modal.classList.remove('open');
    if (!document.querySelector('.modal-overlay.open')) document.body.classList.remove('modal-open');
    if (restoreFocus && modalReturnFocus?.isConnected) modalReturnFocus.focus({ preventScroll: true });
    if (restoreFocus) modalReturnFocus = null;
}

function initModals() {
    // 닫기 버튼
    document.getElementById('close-preview')?.addEventListener('click', closePreview);
    document.getElementById('close-changelog')?.addEventListener('click', closeChangelog);
    document.getElementById('close-pc-guide')?.addEventListener('click', closePcGuide);
    document.getElementById('close-mobile-guide')?.addEventListener('click', closeMobileGuide);
    document.getElementById('close-install-guide')?.addEventListener('click', closeInstallGuide);
    document.getElementById('close-privacy-guide')?.addEventListener('click', closePrivacyGuide);
    document.getElementById('close-font-guide')?.addEventListener('click', closeFontGuide);
    document.getElementById('close-shortcuts')?.addEventListener('click', closeShortcuts);
    document.getElementById('recheck-fonts-btn')?.addEventListener('click', () => renderFontGuide());

    // 업데이트 내역 열기 버튼 (유틸리티 바)
    document.getElementById('open-changelog')?.addEventListener('click', showChangelog);
    document.getElementById('open-pc-guide')?.addEventListener('click', showPcGuide);
    document.getElementById('open-mobile-guide')?.addEventListener('click', showMobileGuide);
    document.getElementById('open-install-guide')?.addEventListener('click', showInstallGuide);
    document.getElementById('open-privacy-guide')?.addEventListener('click', showPrivacyGuide);
    document.getElementById('open-font-guide')?.addEventListener('click', showFontGuide);
    document.getElementById('open-shortcuts')?.addEventListener('click', showShortcuts);
    document.getElementById('open-rhwp-precise')?.addEventListener('click', loadRhwpPrecise);

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
    document.getElementById('privacy-guide-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closePrivacyGuide();
    });
    document.getElementById('font-guide-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeFontGuide();
    });
    document.getElementById('shortcuts-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeShortcuts();
    });

    // ESC: 모달이 열려 있으면 닫고, 아니면 초기화 버튼과 동일하게 동작
    document.addEventListener('keydown', (e) => {
        const open = document.querySelector('.modal-overlay.open');
        if (e.key === 'Tab' && open) {
            const focusable = getModalFocusable(open);
            if (!focusable.length) {
                e.preventDefault();
                open.focus();
            } else {
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
            return;
        }
        if (e.key !== 'Escape') return;
        const modalOpen = !!open;
        if (modalOpen) {
            e.preventDefault();
            closeModal(open);
            return;   // 모달을 닫은 경우엔 초기화하지 않음
        }
        const ae = document.activeElement;
        const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
        if (typing) { ae.blur(); return; }   // 입력 중이면 포커스 해제만
        resetConverterState();
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
    closeModal(document.getElementById('preview-modal'));
}

function closeChangelog() {
    closeModal(document.getElementById('changelog-modal'));
}

function showPcGuide() {
    openModal(document.getElementById('pc-guide-modal'));
}

function closePcGuide() {
    closeModal(document.getElementById('pc-guide-modal'));
}

function showMobileGuide() {
    openModal(document.getElementById('mobile-guide-modal'));
}

function closeMobileGuide() {
    closeModal(document.getElementById('mobile-guide-modal'));
}

function showPrivacyGuide() {
    openModal(document.getElementById('privacy-guide-modal'));
}

function closePrivacyGuide() {
    closeModal(document.getElementById('privacy-guide-modal'));
}

function showShortcuts() {
    openModal(document.getElementById('shortcuts-modal'));
}

function closeShortcuts() {
    closeModal(document.getElementById('shortcuts-modal'));
}

function showInstallGuide() {
    openModal(document.getElementById('install-guide-modal'));
}

function closeInstallGuide() {
    closeModal(document.getElementById('install-guide-modal'));
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
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput.click();
        }
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
// [공용 토스트 안내]
// ─────────────────────────────────────────────────────────────────────────
/**
 * 화면 하단 중앙 토스트 안내.
 * 한 번에 하나만 표시되며 닫기 버튼·자동 제거를 제공한다.
 * [보안] 내부 호출 전용 — 신뢰된 HTML 문자열만 전달할 것(사용자 입력 금지).
 * @param {string} html      토스트 본문 HTML (보통 <strong>·<span> 사용)
 * @param {object} [opts]    { timeout }  자동 제거(ms), 0이면 수동 닫기만
 */
function showToast(html, { timeout = 4000 } = {}) {
    document.getElementById('app-toast')?.remove();
    clearTimeout(showToast._timer);

    const toast = document.createElement('div');
    toast.id        = 'app-toast';
    toast.className = 'app-toast';
    toast.innerHTML = `${html}<button class="app-toast-close" aria-label="닫기">✕</button>`;
    document.body.appendChild(toast);

    const close = () => { clearTimeout(showToast._timer); toast.remove(); };
    toast.querySelector('.app-toast-close').addEventListener('click', close);
    if (timeout > 0) showToast._timer = setTimeout(close, timeout);
    requestAnimationFrame(() => toast.classList.add('app-toast--show'));
    return toast;
}

function initResetButton() {
    const btn = document.getElementById('reset-btn');
    if (!btn) return;
    btn.addEventListener('click', resetConverterState);
}


// ─────────────────────────────────────────────────────────────────────────
// [테마 (다크/라이트)]
//   <head> 인라인 스크립트가 첫 페인트 전에 html[data-theme]를 이미 설정한다(FOUC 방지).
//   여기서는 토글 버튼·Shift+D 단축키·시스템 변경 동기화와 버튼/메타 UI 갱신만 담당.
//   저장 키: tohwpx_theme ('dark'|'light'). 저장값이 없으면 시스템 설정(prefers-color-scheme)을 따른다.
//   ※ 테마는 전역 환경설정이므로 변환 옵션 초기화(↺)에는 일부러 포함하지 않는다.
// ─────────────────────────────────────────────────────────────────────────
const THEME_KEY = 'tohwpx_theme';

function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

/** 현재 적용 중인(해석된) 테마 — 저장된 명시적 선택 우선, 없으면 시스템 */
function getResolvedTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
    return systemPrefersDark() ? 'dark' : 'light';
}

/** data-theme 속성 + 토글 버튼 + theme-color 메타를 한 번에 적용 */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeToggleUI(theme);
    updateThemeColorMeta(theme);
}

function updateThemeToggleUI(theme) {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const isDark = theme === 'dark';
    const icon  = document.getElementById('theme-toggle-icon');
    const label = document.getElementById('theme-toggle-label');
    // 아이콘/라벨은 "지금 누르면 전환될 방향"을 안내한다.
    if (icon)  icon.textContent  = isDark ? '☀️' : '🌙';
    if (label) label.textContent = isDark ? '라이트' : '다크';
    btn.setAttribute('aria-pressed', String(isDark));
    btn.setAttribute('aria-label', isDark ? '라이트 모드 켜기' : '다크 모드 켜기');
}

function updateThemeColorMeta(theme) {
    const meta = document.getElementById('theme-color-meta');
    if (!meta) return;
    // 라이트는 기존 브랜드 블루 유지, 다크는 헤더 표면색(#1c1e26)에 맞춘다.
    meta.setAttribute('content', theme === 'dark' ? '#1c1e26' : '#2563eb');
}

/** 토글: 현재 해석된 테마의 반대로 전환하고 명시적으로 저장 */
function toggleTheme() {
    const next = getResolvedTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
}

function initTheme() {
    // 인라인 스크립트가 data-theme를 이미 설정했으므로 여기선 버튼/메타만 동기화.
    applyTheme(getResolvedTheme());

    const btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', toggleTheme);

    // 저장된 명시적 선택이 없을 때만 OS 테마 변경을 실시간 반영한다.
    if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => {
            if (!localStorage.getItem(THEME_KEY)) {
                applyTheme(systemPrefersDark() ? 'dark' : 'light');
            }
        };
        if (mq.addEventListener)  mq.addEventListener('change', onChange);
        else if (mq.addListener)  mq.addListener(onChange);   // 구형 사파리 폴백
    }
}

function resetConverterState() {
    clearSelectedFile();
    hideAlert();

    // 직접 입력 내용·모드 초기화 → 파일 업로드 모드로 복귀
    const pasteInputEl = document.getElementById('paste-input');
    const pasteNameEl  = document.getElementById('paste-name');
    if (pasteInputEl) pasteInputEl.value = '';
    if (pasteNameEl)  pasteNameEl.value = '';
    if (state.inputMode !== 'upload') setInputMode('upload');

    state.docType = 'plain';
    state.customTitle = '';
    state.titleSource = 'heading';
    state.docFont = '맑은 고딕';
    state.fontSize = 12;
    state.paperSize = 'A4';
    state.orientation = 'portrait';
    state.pageMargins = { top: 10, bottom: 10, left: 20, right: 20, header: 10, footer: 10 };
    state.autoDownload = true;

    for (const key of ['tohwpx_font', 'tohwpx_fontSize', 'tohwpx_paperSize', 'tohwpx_autoDownload', 'tohwpx_orientation']) {
        localStorage.removeItem(key);
    }

    const docFont = document.getElementById('doc-font');
    const fontSize = document.getElementById('font-size');
    const paperSize = document.getElementById('paper-size');
    const autoDownload = document.getElementById('auto-download');
    const plainRadio = document.querySelector('input[name="doc-type"][value="plain"]');
    if (plainRadio) plainRadio.checked = true;
    const titleSrc = document.getElementById('title-source');
    if (titleSrc) titleSrc.value = 'heading';
    updateTitlePlaceholder('heading');
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
    showToast('<strong>↺ 초기화 완료</strong> <span>선택 파일과 변환 옵션을 기본값으로 되돌렸습니다.</span>');
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' }));
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

/** IR 인라인 런 배열 → HTML (bold/italic/underline/strike/color/code/footnote) */
function irRunsToHtml(runs) {
    let h = '';
    for (const r of (runs || [])) {
        if (r.footnote) { h += `<sup class="ir-fn" title="${escHtml(r.footnote)}">[주]</sup>`; continue; }
        let t = escHtml(r.text || '');
        if (!t) continue;
        if (r.code) { h += `<code>${t}</code>`; continue; }
        if (r.bold) t = `<strong>${t}</strong>`;
        if (r.italic) t = `<em>${t}</em>`;
        const deco = [];
        if (r.underline) deco.push('underline');
        if (r.strike) deco.push('line-through');
        const css = (r.color && /^#[0-9A-Fa-f]{6}$/.test(r.color) ? `color:${r.color};` : '')
                  + (deco.length ? `text-decoration:${deco.join(' ')};` : '');
        h += css ? `<span style="${css}">${t}</span>` : t;
    }
    return h;
}

/** IR list 블록 → HTML (중첩 level 들여쓰기·번호·체크박스) */
function irListToHtml(block) {
    const cell = v => escHtml(typeof v === 'object' ? (v?.text ?? '') : String(v ?? ''));
    let h = '<div class="ir-list">', auto = 0;
    for (const raw of (block.items || [])) {
        const it = typeof raw === 'object' ? raw : { text: raw };
        const level = Math.max(0, Math.min(it.level || 0, 4));
        const ordered = it.ordered != null ? it.ordered : !!block.ordered;
        let marker;
        if (it.task) marker = it.checked ? '☑' : '☐';
        else if (ordered) marker = `${it.marker != null ? it.marker : (++auto)}.`;
        else marker = '•';
        h += `<div class="ir-li" style="padding-left:${level * 1.4 + 1}em">${marker} ${cell(it)}</div>`;
        for (const cb of (it.codeBlocks || [])) h += `<pre class="ir-code"><code>${escHtml(cb.text || '')}</code></pre>`;
    }
    return h + '</div>';
}

/** IR table 블록 → HTML (머리행·셀 배경색·병합 반영) */
function irTableToHtml(block) {
    const txt = c => escHtml(typeof c === 'object' ? (c?.text ?? '') : String(c ?? ''));
    const bg  = c => (typeof c === 'object' ? (c?.bg || null) : null);
    const cs  = c => (typeof c === 'object' ? (c?.colSpan || 1) : 1);
    const rs  = c => (typeof c === 'object' ? (c?.rowSpan || 1) : 1);
    const rows = (block.header && block.header.length ? [{ cells: block.header, hd: true }] : [])
        .concat((block.rows || []).map(r => ({ cells: r, hd: false })));
    let h = '<table class="ir-table"><tbody>';
    for (const row of rows) {
        h += '<tr>';
        for (const c of (row.cells || [])) {
            if (rs(c) === 0) continue;   // 세로병합 연속 sentinel
            const tag = row.hd ? 'th' : 'td';
            const span = `${cs(c) > 1 ? ` colspan="${cs(c)}"` : ''}${rs(c) > 1 ? ` rowspan="${rs(c)}"` : ''}`;
            const b = bg(c);
            const style = b ? ` style="background:#${escHtml(b)}"` : '';
            h += `<${tag}${span}${style}>${txt(c)}</${tag}>`;
        }
        h += '</tr>';
    }
    return h + '</tbody></table>';
}

/** IR blocks → HTML (재귀: 인용 중첩 지원) */
function irBlocksToHtml(blocks) {
    let h = '';
    for (const b of (blocks || [])) {
        switch (b.type) {
            case 'heading': { const l = Math.min(b.level || 1, 6); h += `<h${l}>${escHtml(b.text || '')}</h${l}>`; break; }
            case 'para':
                if (b.runs && b.runs.length) { const inner = irRunsToHtml(b.runs); h += `<p>${inner || '&nbsp;'}</p>`; }
                else if (b.text && b.text.trim()) h += `<p>${escHtml(b.text)}</p>`;
                else h += '<p>&nbsp;</p>';
                break;
            case 'blank': h += '<p>&nbsp;</p>'; break;
            case 'hr':    h += '<hr>'; break;
            case 'code':  h += `<pre class="ir-code"><code>${escHtml(b.text || '')}</code></pre>`; break;
            case 'list':  h += irListToHtml(b); break;
            case 'table': h += irTableToHtml(b); break;
            case 'quote': h += `<blockquote>${irBlocksToHtml(b.blocks)}</blockquote>`; break;
            case 'image': h += `<p class="ir-image">🖼 [이미지${b.alt ? ': ' + escHtml(b.alt) : ''}]</p>`; break;
            default: if (b.text) h += `<p>${escHtml(b.text)}</p>`;
        }
    }
    return h;
}

const PREVIEW_PAPER_MM = {
    A3:     { width: 297, height: 420 },
    A4:     { width: 210, height: 297 },
    B5:     { width: 182, height: 257 },
    Letter: { width: 215.9, height: 279.4 },
};

function applyPreviewPaper(pageEl) {
    if (!pageEl) return;
    const base = PREVIEW_PAPER_MM[state.paperSize] || PREVIEW_PAPER_MM.A4;
    const landscape = state.orientation === 'landscape';
    const widthMm = landscape ? base.height : base.width;
    const heightMm = landscape ? base.width : base.height;
    const widthPx = Math.round(720 * (widthMm / PREVIEW_PAPER_MM.A4.width));

    pageEl.style.setProperty('--preview-page-width', `${widthPx}px`);
    pageEl.style.setProperty('--preview-page-ratio', `${widthMm} / ${heightMm}`);
    pageEl.dataset.paper = state.paperSize || 'A4';
    pageEl.dataset.orientation = landscape ? 'landscape' : 'portrait';
}

function paginatePreview(irBox) {
    const firstPage = irBox?.querySelector('.ir-page');
    if (!firstPage) return 0;

    const content = Array.from(firstPage.children);
    firstPage.replaceChildren();
    const pages = [firstPage];

    const sizePage = page => {
        applyPreviewPaper(page);
        const base = PREVIEW_PAPER_MM[state.paperSize] || PREVIEW_PAPER_MM.A4;
        const widthMm = state.orientation === 'landscape' ? base.height : base.width;
        const heightMm = state.orientation === 'landscape' ? base.width : base.height;
        page.style.height = `${Math.round(page.getBoundingClientRect().width * heightMm / widthMm)}px`;
    };
    sizePage(firstPage);

    for (const node of content) {
        let page = pages[pages.length - 1];
        page.appendChild(node);
        if (page.scrollHeight <= page.clientHeight + 1 || page.children.length === 1) continue;

        node.remove();
        page = document.createElement('div');
        page.className = 'ir-page';
        irBox.appendChild(page);
        pages.push(page);
        sizePage(page);
        page.appendChild(node);
    }

    return pages.length;
}

/** 미리보기 모달 열기 — 기본은 IR을 HTML로 즉시 렌더(빠르고 100% 로컬) */
function openPreview(blob) {
    const modal = document.getElementById('preview-modal');
    if (!modal) return;
    openModal(modal);

    const irBox   = document.getElementById('preview-ir');
    const wrap    = document.getElementById('preview-iframe-wrap');
    const countEl = document.getElementById('preview-pagecount');
    if (countEl) countEl.textContent = '';
    if (wrap) wrap.hidden = true;          // 정밀(rhwp) 영역은 기본 숨김
    if (irBox) {
        irBox.hidden = false;
        irBox.innerHTML = state.ir
            ? `<div class="ir-page">${state.ir.title && state.ir.title.trim()
                ? `<h1 class="ir-title">${escHtml(state.ir.title.trim())}</h1>` : ''}${irBlocksToHtml(state.ir.blocks)}</div>`
            : '<p class="preview-empty">미리보기할 내용이 없습니다. 먼저 파일을 변환해 주세요.</p>';
        const pageCount = paginatePreview(irBox);
        if (countEl && pageCount > 1) {
            countEl.textContent = `${state.paperSize || 'A4'} · ${state.orientation === 'landscape' ? '가로' : '세로'} · ${pageCount}쪽`;
        }
    }
    if (countEl && !countEl.textContent) {
        countEl.textContent = `${state.paperSize || 'A4'} · ${state.orientation === 'landscape' ? '가로' : '세로'}`;
    }
}

/** 정밀 미리보기 — 외부 rhwp(WebAssembly) 뷰어를 선택적으로 로드 */
async function loadRhwpPrecise() {
    const wrap    = document.getElementById('preview-iframe-wrap');
    const irBox   = document.getElementById('preview-ir');
    const iframe  = document.getElementById('rhwp-iframe');
    const loading = document.getElementById('preview-loading');
    const countEl = document.getElementById('preview-pagecount');
    if (!wrap || !iframe || !state.hwpxBlob) return;

    if (irBox) irBox.hidden = true;
    wrap.hidden = false;
    if (!iframe.src && iframe.dataset.src) iframe.src = iframe.dataset.src;  // 클릭 시에만 외부 로드

    loading.classList.remove('preview-loading--fallback');
    loading.style.display = 'flex';
    loading.innerHTML = `
        <div style="text-align:center">
            <div class="loading-spinner"></div>
            <p>rhwp 뷰어를 불러오는 중...</p>
            <p class="preview-loading-sub">최초 실행 시 WebAssembly 로드로 10~20초 소요될 수 있습니다</p>
        </div>`;

    try {
        if (!_rhwpClient) _rhwpClient = new RhwpEditorClient(iframe);
        await _rhwpClient.waitReady();
        const buf      = await state.hwpxBlob.arrayBuffer();
        const fileName = (state.file?.name || 'document').replace(/\.[^.]+$/, '') + '.hwpx';
        const result   = await _rhwpClient.loadFile(buf, fileName);
        if (result?.pageCount && countEl) countEl.textContent = `총 ${result.pageCount}페이지`;
        loading.style.display = 'none';
    } catch (err) {
        console.error('[rhwp]', err);
        loading.innerHTML = `
            <div style="text-align:center;padding:24px">
                <p style="font-size:1.8rem;margin-bottom:10px">⚠</p>
                <p style="font-weight:600;color:var(--c-error)">정밀 미리보기를 불러오지 못했습니다</p>
                <p style="font-size:0.8rem;color:var(--c-text-muted);margin-top:6px">${escHtml(err.message || '')}</p>
                <p style="font-size:0.78rem;color:var(--c-text-muted);margin-top:4px">
                    기본 미리보기를 사용하거나, 다운로드 후 한컴오피스에서 확인하세요.
                </p>
            </div>`;
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

    openModal(modal);

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

    el.innerHTML = `${groups.map(group => `
        <section class="changelog-date-group">
            <div class="changelog-date-heading">${escHtml(group.date)}</div>
            ${tab === 'user' ? renderMergedUserChangelog(group.versions) : renderVersionedChangelog(group.versions, tab)}
        </section>
    `).join('')}`;
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
