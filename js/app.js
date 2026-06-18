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
    docFont:      'KoPubDotumMedium',  // 출력 폰트 (index.html #doc-font select 값)
    paperSize:    'A4',                // 용지 크기: "A4" | "B5" | "Letter"
    pageMargins:  { top: 20, bottom: 20, left: 30, right: 30 },  // 단위: mm
    isConverting: false                // 변환 중 중복 실행 방지 플래그
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

// ─────────────────────────────────────────────────────────────────────────
// [DOM 준비 후 초기화]
//   모든 기능 초기화를 DOMContentLoaded 이후 실행
// ─────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    renderPipelineSteps();  // 파이프라인 단계 DOM 렌더링
    initDropZone();          // 파일 드롭/선택 영역
    initFormatTabs();        // 포맷 탭 전환 (기본/확장 서비스)
    initFormatCards();       // 포맷 카드 클릭 이벤트
    initOptions();           // 문서 유형·제목 옵션
    initConvertButton();     // 변환 시작 버튼
    initScrollBehavior();    // 스크롤 시 헤더 효과
    initMobileMenu();        // 모바일 햄버거 메뉴
    initNavLinks();          // 부드러운 스크롤 네비게이션
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
            handleFileSelect(e.target.files[0]);
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
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
    });

    // 페이지 전체 드롭 방지 (드롭존 외부에 놓으면 브라우저가 파일을 열어버리는 것 방지)
    document.addEventListener('dragover',  (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        // 드롭존 영역이 아닌 곳에 드롭해도 처리
        if (file) handleFileSelect(file);
    });
}

/**
 * 파일 선택 처리
 * 상태 업데이트 → 포맷 감지 → UI 갱신 → 이전 결과 초기화
 */
function handleFileSelect(file) {
    // [보안] 클라이언트 사이드 파일 크기 사전 검사 (20MB)
    const MAX_MB = 20;
    if (file.size > MAX_MB * 1024 * 1024) {
        showAlert(`파일 크기 초과: ${(file.size / 1024 / 1024).toFixed(1)}MB (최대 ${MAX_MB}MB 지원)`);
        return;
    }

    state.file = file;
    state.ir   = null;

    const ext = file.name.split('.').pop().toLowerCase();
    updateDropZoneUI(file, ext);     // 드롭존에 파일 정보 표시
    updateFormatBadge(ext);          // 감지된 포맷 배지 표시
    updateConvertButton(true);       // 변환 버튼 활성화
    hideResult();                    // 이전 변환 결과 숨기기
    resetPipeline();                 // 파이프라인 초기화

    // 변환기 패널로 부드럽게 스크롤
    document.getElementById('converter')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 드롭존 내부 UI를 파일 선택 상태로 업데이트 */
function updateDropZoneUI(file, ext) {
    const dz = document.getElementById('drop-zone');
    if (!dz) return;

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

/** 감지된 포맷 배지 업데이트 */
function updateFormatBadge(ext) {
    const badge = document.getElementById('detected-format');
    if (!badge) return;
    badge.textContent  = ext.toUpperCase();
    badge.style.display = 'inline-flex';
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

/** 포맷 카드 클릭 → 변환기 섹션으로 스크롤 + 힌트 표시 */
function initFormatCards() {
    document.querySelectorAll('.format-card').forEach(card => {
        card.addEventListener('click', () => {
            if (card.classList.contains('coming-soon')) return;

            const ext  = card.dataset.ext || '';
            const hint = document.getElementById('format-hint');
            if (hint && ext) {
                hint.textContent = `.${ext.toUpperCase()} 파일을 업로드하세요`;
                hint.style.display = 'block';
            }
            // 변환기 섹션으로 스크롤
            document.getElementById('converter')?.scrollIntoView({ behavior: 'smooth' });
        });
    });
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

    // 폰트 선택 (<select id="doc-font">)
    const fontEl = document.getElementById('doc-font');
    if (fontEl) {
        fontEl.addEventListener('change', () => { state.docFont = fontEl.value; });
    }

    // 용지 크기 선택 (<select id="paper-size">)
    const paperEl = document.getElementById('paper-size');
    if (paperEl) {
        paperEl.addEventListener('change', () => { state.paperSize = paperEl.value; });
    }

    // 페이지 여백 입력 (mm 단위, #margin-top/bottom/left/right)
    const marginIds = ['top', 'bottom', 'left', 'right'];
    marginIds.forEach(side => {
        const el = document.getElementById(`margin-${side}`);
        if (!el) return;
        el.addEventListener('change', () => {
            const val = parseInt(el.value, 10);
            // 최소/최대 클램핑 (5mm ~ 60mm)
            if (!isNaN(val)) {
                state.pageMargins[side] = Math.max(5, Math.min(60, val));
                el.value = state.pageMargins[side];
            }
        });
    });

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
// [변환 버튼]
// ─────────────────────────────────────────────────────────────────────────
function initConvertButton() {
    const btn = document.getElementById('convert-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (!state.file || state.isConverting) return;
        runConversionPipeline();
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
    hideResult();
    hideAlert();
    updateConvertButton(false);

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
            // 파싱 오류 시 오류 메시지를 IR 블록에 담아 계속 진행
            ir = {
                title: state.file.name,
                doc_type: state.docType,
                blocks: [{ type: 'para', text: '파일 파싱 오류: ' + e.message }]
            };
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
            // hwpx.js의 buildHwpx() 호출 (폰트·여백·용지 전달)
            hwpxBlob = await buildHwpx(ir, state.docFont, state.pageMargins, state.paperSize);
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
            validation = await validateHwpx(hwpxBlob);
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

        const finalBlob = hwpxBlob;  // 클라이언트 사이드 복구 제한으로 현재는 원본 사용
        // [향후 개선] 검증 실패 패턴에 따른 자동 수정 로직 추가 가능
        setStepState('repair', 'done');

        // ═══ 7단계: Ship (다운로드 준비) ═══
        setStepState('ship', 'active');
        setProgress(98);
        setStatusText('다운로드를 준비하는 중...');
        await tick();

        // 출력 파일명: 원본 확장자를 .hwpx로 교체
        const baseName = state.file.name.replace(/\.[^.]+$/, '');
        const fileName = `${baseName}.hwpx`;

        // [보안] Blob URL 생성 → 60초 후 자동 해제 (메모리 누수 및 개인정보 보호)
        const downloadUrl = URL.createObjectURL(finalBlob);
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);

        setStepState('ship', 'done');
        setProgress(100);
        setStatusText('완료!');

        // 결과 카드 표시
        showResult({ url: downloadUrl, fileName, size: finalBlob.size, validation });

    } catch (err) {
        showAlert('변환 중 오류가 발생했습니다: ' + err.message);
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

    // 검증 결과에 따른 표시 텍스트
    const validText = validation.pass
        ? '✓ 4개 검증 영역 모두 PASS — 한글 호환 구조 충족'
        : '⚠ 검증 경고: ' + validation.issues.join(' | ');
    const validClass = validation.pass ? 'result-valid' : 'result-warn';

    // [보안] URL은 blob: 스킴만 가능 (직접 생성했으므로 안전)
    //         escHtml()로 fileName을 이스케이프하여 XSS 방지
    area.innerHTML = `
        <div class="result-card">
            <div class="result-file-row">
                <span class="result-file-icon">📄</span>
                <div class="result-file-info">
                    <strong>${escHtml(fileName)}</strong>
                    <span class="result-file-size">${formatBytes(size)}</span>
                </div>
            </div>
            <div class="result-validation ${validClass}">
                ${escHtml(validText)}
            </div>
            <a href="${url}"
               download="${escHtml(fileName)}"
               class="btn-download"
               onclick="this.closest('.result-card').querySelector('.result-validation').textContent += ' (다운로드됨)'">
                ⬇ HWPX 다운로드
            </a>
            <p class="result-note">이 링크는 60초 후 만료됩니다. 바로 다운로드하세요.</p>
        </div>
    `;
    area.style.display = 'block';
    area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** 결과 영역 숨기기 및 내용 초기화 */
function hideResult() {
    const area = document.getElementById('result-area');
    if (area) {
        area.style.display = 'none';
        area.innerHTML = '';
    }
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
}

/** 상태 텍스트 업데이트 */
function setStatusText(msg) {
    const el = document.getElementById('status-text');
    if (el) el.textContent = msg;
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
