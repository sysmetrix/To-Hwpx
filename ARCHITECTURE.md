# To-Hwpx 아키텍처

## 시스템 경계

To-Hwpx는 빌드 없는 정적 브라우저 앱이다. 입력 파일은 브라우저 밖으로 전송하지 않으며 다음 단방향 파이프라인을 사용한다.

```text
File
  → format audit / resolver
  → parser
  → IR v2
  → HWPX renderer
  → package validator
  → browser download
  → Hancom render QA (release evidence)
```

`js/parsers.js`는 원본 형식의 문법을 해석하고, `js/hwpx.js`는 입력 확장자를 모른 채 IR만 렌더링한다. DOCX만 입력 자체가 손상되었을 수 있으므로 `js/docx-audit.js`가 파서 앞에서 `word/document.xml`을 감사하고, 의미를 바꾸지 않는 결함만 정규화한다.

## DOCX 고충실도 경로

```text
DOCX ZIP
  ├─ document.xml ─→ audit/repair ─→ 문단·표·셀·줄바꿈
  ├─ styles.xml ───────────────────→ 기본 글자 크기·줄 간격
  ├─ numbering.xml ────────────────→ 목록
  ├─ rels/media ───────────────────→ 링크·그림
  └─ comments/footnotes/header ────→ 보조 콘텐츠
                         ↓
IR v2: audit + pageSetup + typography + blocks
                         ↓
HWPX: pagePr + char/paraPr + tbl/subList + hp:lineBreak
```

### 감사와 복구 경계

자동 복구는 다음 네 종류로 제한한다.

- `undefined`, `null`, `NaN` 리터럴 속성 제거
- 정수여야 하는 `gridCol`·`tcW` twip 반올림
- 최종 `sectPr`를 `body` 마지막으로 이동
- OOXML 스키마에서 순서가 정의된 속성 컨테이너의 자식 재배열

텍스트 삭제, 표 재작성, 임의 스타일 추론처럼 의미를 바꿀 수 있는 복구는 하지 않는다. 감사 결과는 `ir.audit`에 남아 결과 카드와 하네스가 같은 사실을 사용한다.

### IR v2 계약

DOCX 경로가 추가하는 공통 메타데이터는 다음과 같다.

```js
{
  schemaVersion: 2,
  audit: { sourceFormat, status, issues, repairs, metrics },
  pageSetup: { widthHwp, heightHwp, orientation, marginsHwp },
  typography: { baseFontSizePt, lineSpacingPercent },
  blocks: [{
    type: 'table', widthHwp, columnWidthsHwp, align, cellMarginsHwp, rowMeta,
    header: [{ text, blocks, colSpan, rowSpan, widthHwp, vertAlign, marginsHwp }],
    rows: []
  }]
}
```

표 셀 `blocks`는 문단·목록·중첩 표·그림의 순서를 보존한다. `text`는 검색·미리보기용 평문 파생값일 뿐 렌더링의 단일 원본이 아니다. 수동 줄바꿈과 탭은 run의 `text` 안에서 `\n`, `\t`로 유지하고 HWPX에서 `hp:lineBreak`, `hp:tab`으로 직렬화한다.

## 품질 불변식

- 입력 감사가 `blocked`면 HWPX를 만들지 않는다.
- DOCX 표·행·셀 수는 입력 감사값과 출력 HWPX가 같아야 한다.
- 수동 줄바꿈 출력 수는 입력보다 작아지면 안 된다.
- 원본 페이지 설정을 선택한 DOCX는 `pagePr` 크기·방향과 여백을 보존한다.
- 표 열 너비는 원본 `tblGrid` 비율을 유지하되 본문 폭을 넘을 때만 비례 축소한다.
- 한 셀의 여러 문단을 단일 문자열 문단으로 합치지 않는다.
- 구조 게이트 통과는 시각 통과가 아니다. 릴리스 후보는 한컴에서 PDF로 내보내 모든 페이지를 contact sheet로 확인한다.

## 신뢰 기준과 참고 구현

- OOXML의 패키지·어휘 기준은 [ECMA-376 공식 배포](https://ecma-international.org/publications-and-standards/standards/ecma-376/)를 우선한다.
- 최종 `sectPr`가 `body` 마지막 자식이라는 규칙은 [Microsoft Open XML `SectionProperties`](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.sectionproperties)와 대조한다.
- Word 표 셀이 여러 문단·중첩 표를 포함할 수 있다는 계약은 [Microsoft Open XML `TableCell`](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.tablecell)과 대조한다.
- HWPX는 한컴이 공개한 OWPML/KS X 6101 계열 형식이다. [한컴 HWP/OWPML 공개 자료](https://notice.hancom.com/support/downloadCenter/hwpOwpml)와 [한컴테크 HWPX 구조 설명](https://tech.hancom.com/hwpxformat/)을 기준으로 삼는다.
- 실제 HWPX 요소 순서·중첩은 [neolord0/hwpxlib](https://github.com/neolord0/hwpxlib)의 writer와 `testFile` 샘플을 상호 대조한다.

결정의 배경과 기각안은 [docs/adr](docs/adr)에 기록한다. 변경 영향과 검증 루프는 [ENGINEERING.md](ENGINEERING.md)를 따른다.
