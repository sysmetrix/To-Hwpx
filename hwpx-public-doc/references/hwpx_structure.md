# HWPX OPC 컨테이너 / OWPML 구조

생성·검증·복구 시 참조할 HWPX 내부 구조 설명임. 베이스 템플릿을 수정하거나 새 블록 타입을 추가할 때 읽음.

## 1. HWPX는 OPC(ZIP) 컨테이너

HWPX는 여러 XML을 ZIP으로 묶은 패키지임. DOCX·EPUB와 같은 OPC 계열이지만 **mimetype 규칙이 엄격**함.

```
document.hwpx (ZIP)
├── mimetype              ← 첫 항목 + 무압축(ZIP_STORED) 필수
├── version.xml
├── settings.xml
├── META-INF/
│   ├── container.xml     ← rootfile 경로 선언
│   ├── container.rdf
│   └── manifest.xml      ← 파일 목록
├── Contents/
│   ├── content.hpf       ← opf:package (매니페스트)
│   ├── header.xml        ← 글꼴·문단모양·글자모양·테두리 정의
│   └── section0.xml      ← 본문 (동적 생성 대상)
└── Preview/
    ├── PrvText.txt       ← 미리보기 텍스트
    └── PrvImage.png      ← 미리보기 이미지
```

### mimetype 규칙 (가장 흔한 실패 원인)

- ZIP 아카이브의 **물리적 첫 항목**이어야 함.
- **압축하지 않음**(ZIP_STORED). DEFLATE로 저장하면 한글이 손상 파일로 인식.
- 내용은 정확히 `application/hwp+zip`.

`build_hwpx.py`의 `package_hwpx()`가 이 규칙을 강제함. 패키징 로직을 바꿀 때 이 세 조건을 깨지 않아야 함.

## 2. OWPML 네임스페이스

| 접두어 | 네임스페이스 | 용도 |
|--------|-------------|------|
| hh | .../2011/head | header.xml 루트 |
| hs | .../2011/section | section 루트 |
| hp | .../2011/paragraph | 단락·런·표 |
| hv | .../2011/version | version.xml |
| ocf | urn:oasis...container | META-INF/container.xml |
| opf | .../2007/opf/ | content.hpf |

section0.xml은 반드시 hs·hp 네임스페이스를 선언해야 함. 누락 시 빈 문서로 열림.

## 3. header.xml의 참조 ID 체계

section0.xml은 직접 서식값을 갖지 않고 header.xml에 정의된 ID를 참조함.

- `charPr id="N"` ← section의 `charPrIDRef="N"` (글자모양: 크기·굵기·색·글꼴)
- `paraPr id="N"` ← section의 `paraPrIDRef="N"` (문단모양: 정렬·줄간격·여백)
- `borderFill id="N"` ← 표 셀의 `borderFillIDRef="N"` (테두리·음영)
- `fontface ... font id="N"` ← charPr의 `fontRef hangul="N"`

**참조 무결성**: section이 쓰는 모든 ID가 header에 정의돼 있어야 함. `validate_hwpx.py`의 4번 검사가 이를 자동 대조함. 새 글자모양(예: 빨강·밑줄)을 쓰려면 먼저 header.xml에 charPr를 추가하고 그 id를 section에서 참조해야 함.

현재 베이스 템플릿 정의:
- charPr id=0: 본문 10pt
- charPr id=1: 제목 14pt 굵게
- paraPr id=0: 양끝정렬·줄간격 160%
- borderFill id=1: 테두리 없음 / id=2: 실선 / id=3: 실선+음영(표 헤더)

## 4. 표(table) 구조

표는 `hp:tbl` 안에 `hp:tr`(행) > `hp:tc`(셀) > `hp:subList` > `hp:p`(단락) 계층임.

- `rowCnt`·`colCnt`가 실제 행·열 수와 일치해야 함.
- 각 셀의 `cellAddr colAddr/rowAddr`이 0-based로 정확해야 함.
- 셀 병합은 `cellSpan colSpan/rowSpan`으로 표현(현재 생성기는 1×1만).

## 5. 확장 시 체크포인트

새 기능 추가 시 반드시 확인:
1. 새 서식 → header.xml에 정의 추가 → section에서 ID 참조
2. 패키징 변경 → mimetype 3조건 유지
3. 변경 후 → `validate_hwpx.py`로 4영역 전부 PASS 확인
4. 베이스 템플릿의 기존 ID는 삭제·재번호하지 않음(기존 문서 호환 깨짐)
