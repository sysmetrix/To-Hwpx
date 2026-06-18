---
name: hwpx-public-doc
description: 공공기관 공문·보고서를 한컴 오피스 없이 HWPX 파일로 생성·검증함. Markdown·텍스트·표 데이터를 받아 한글에서 정상적으로 열리는 .hwpx 산출물을 만들 때 사용. "공문 만들어줘", "HWPX로 뽑아줘", "한글 문서 생성", "보고서를 hwpx로", "한글 파일 작성" 등 HWPX·한글 문서 산출이 필요한 모든 요청에서 반드시 사용. 명사형 종결·가운뎃점 서식 등 공공문서 스타일도 함께 처리.
---

# HWPX 공공문서 생성기

한컴 오피스 없이 순수 Python으로 한글(HWPX) 공문·보고서를 생성하고, 한글 프로그램에서 정상적으로 열리는지 검증하는 스킬임.

핵심 전제: HWPX는 OPC(ZIP+XML) 컨테이너임. mimetype을 무압축(ZIP_STORED)으로 ZIP 첫 항목에 배치하고 META-INF·Preview 구조를 지켜야 한글에서 열림. 이 구조를 깨면 "변환 성공처럼 보이지만 한글에서 오류"가 발생함. 따라서 생성과 검증은 한 쌍으로 동작함.

## 작업 원칙 (Karpathy 선별 채택)

이 스킬은 행동 규칙 중 검증된 두 가지만 적용함. 통째 복붙이 아니라 효과가 확인된 항목만 취함.

1. **가정을 먼저 드러낼 것** — 입력 포맷·문서 유형·출력 서식이 불명확하면 추측해서 진행하지 말고 한 번 확인함. 잘못된 가정으로 끝까지 생성하면 전체를 다시 만들어야 함.
2. **외과적으로 생성할 것** — 검증된 베이스 템플릿(`assets/base_template/`)의 고정 부분은 절대 건드리지 않음. `section0.xml`만 동적 생성함. 헤더·컨테이너·Preview를 "개선"하려 하면 한글 호환이 깨짐.

이 두 원칙을 어기지 않는 것이 성공의 불변식임. 나머지 화려한 기능보다 "한글에서 열림 + 템플릿 구조 무손상"이 우선임.

## 전체 흐름

```
입력 감지 → 가정 확인 → IR(구조화 단락) → 생성 → 검증 → (실패 시 복구) → 산출
```

1. **입력 감지**: Markdown·TXT·표 데이터(CSV/리스트) 중 무엇인지 판단함.
2. **가정 확인**: 문서 유형(공문/보고서/일반)·제목·서식 스타일이 모호하면 사용자에게 한 번 확인함.
3. **IR 변환**: 입력을 구조화 단락 리스트로 정규화함(제목·본문·표·목록).
4. **생성**: `scripts/build_hwpx.py`로 베이스 템플릿 위에 section0.xml만 동적 주입함.
5. **검증**: `scripts/validate_hwpx.py`로 ZIP 구조·mimetype·필수 파일·XML 적합성을 자동 검사함.
6. **복구**: 검증 실패 시 오류 메시지를 근거로 IR·생성 단계만 부분 재실행함(최대 3회).
7. **산출**: 검증 통과본만 `present_files`로 제시함.

## 사용법

### 1단계 — 입력 정규화

사용자 입력을 구조화 단락 JSON(IR)으로 변환함. 형식은 `references/ir_schema.md` 참조. 핵심 구조만 보면:

```json
{
  "title": "문서 제목",
  "doc_type": "official",
  "blocks": [
    {"type": "heading", "level": 1, "text": "제목"},
    {"type": "para", "text": "본문 단락임."},
    {"type": "list", "items": ["항목 하나", "항목 둘"]},
    {"type": "table", "header": ["구분", "내용"], "rows": [["가", "나"]]}
  ]
}
```

공공문서 스타일이 요청되면(doc_type가 "official" 또는 "report") 본문을 명사형으로 종결(~임. ~함. ~됨.)하고 목록·병렬은 가운뎃점(·)으로 통일함. 이 변환은 IR 생성 시점에 적용함.

### 2단계 — 생성

IR을 JSON 파일로 저장한 뒤 생성 스크립트를 실행함.

```bash
cd <skill-path>
python scripts/build_hwpx.py --ir /path/to/ir.json --out /mnt/user-data/outputs/document.hwpx
```

스크립트는 `assets/base_template/`의 검증된 구조를 복사하고 section0.xml만 IR로부터 생성해 ZIP_STORED 규칙에 맞춰 패키징함.

### 3단계 — 검증 (생략 금지)

생성 직후 반드시 검증함. 이 단계를 건너뛰면 스킬의 절반만 수행한 것임.

```bash
python scripts/validate_hwpx.py /mnt/user-data/outputs/document.hwpx
```

검증 스크립트는 4개 영역을 자동 점검하고 PASS/FAIL과 실패 사유를 출력함:
- **컨테이너**: mimetype이 첫 항목·무압축·내용 일치, META-INF 3종 존재
- **필수 파일**: Contents/section0.xml·header.xml, Preview/PrvText.txt 존재
- **XML 적합성**: section0.xml이 well-formed이며 네임스페이스 유효
- **참조 무결성**: 참조 ID가 header에 정의됨

FAIL이 나오면 출력된 사유를 근거로 4단계로 진행함.

### 4단계 — 복구 (검증 실패 시)

검증 실패 사유를 IR 또는 생성 로직에 반영해 2~3단계만 재실행함. 베이스 템플릿은 손대지 않음. 3회 시도 후에도 실패하면 사용자에게 구체적 사유와 함께 보고함.

## 검증된 베이스 템플릿 구조

`assets/base_template/`는 한글에서 열림이 확인된 최소 구조임. Canine89/hwpxskill 패턴 기반이며 다음을 포함함:

```
base_template/
├── mimetype                      (ZIP_STORED·첫 배치 필수)
├── version.xml
├── META-INF/
│   ├── container.xml
│   ├── container.rdf
│   └── manifest.xml
├── Contents/
│   ├── header.xml                (글꼴·문단모양·글자모양 정의)
│   └── section0.xml              (← 이것만 동적 생성)
├── Preview/
│   ├── PrvText.txt
│   └── PrvImage.png
└── settings.xml
```

동적 생성 대상은 `Contents/section0.xml` 단 하나임. 나머지는 그대로 복사함.

## 자주 발생하는 실패와 원인

| 증상 | 원인 | 대응 |
|------|------|------|
| 한글이 "파일이 손상됨" 표시 | mimetype이 압축됨 또는 첫 항목 아님 | build 스크립트의 ZIP_STORED 배치 확인 |
| 빈 문서로 열림 | section0.xml 네임스페이스 누락 | header 네임스페이스 선언 점검 |
| 글꼴 깨짐 | 참조한 글꼴 ID가 header 미정의 | header.xml의 fontface ID와 대조 |
| 표 안 보임 | tbl 참조 무결성 깨짐 | IR table 블록의 행·열 수 검증 |

## 참조 파일

- `references/ir_schema.md` — IR(구조화 단락) 전체 스키마와 블록 타입별 예시
- `references/hwpx_structure.md` — HWPX OPC 컨테이너·OWPML 구조 상세

## 산출 형식

검증 통과한 .hwpx만 사용자에게 제시함. 제시 시 적용한 가정(문서 유형·서식 스타일)과 검증 결과를 한 줄로 함께 보고함. 예: "공문 스타일(명사형·가운뎃점)로 생성, 4개 검증 영역 모두 PASS."
