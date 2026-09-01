# ADR 0001 — DOCX 감사·복구 경계

- 상태: 승인
- 일자: 2026-09-01

## 맥락

실패 문서는 ZIP/XML 파싱에는 성공했지만 Open XML SDK 기준 자식 순서 오류, 소수 twip, `undefined` 여백, 잘못 놓인 최종 `sectPr`를 포함했다. 이런 문서는 Word와 한컴이 열지 못해 “원본을 정상 문서로 가정”하는 파서가 품질 원인을 숨긴다.

## 결정

`js/docx-audit.js`를 DOCX 파서 앞에 둔다. 의미 보존이 명확한 네 종류만 자동 정규화하고, 원본 XML과 감사 보고서를 분리한다. 텍스트나 표 구조를 추측해야 하는 결함은 `recoverable-with-loss` 또는 `blocked`로 남긴다.

최종 섹션 속성은 `body` 마지막 자식이어야 한다는 [Microsoft Open XML SectionProperties 설명](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.sectionproperties)을 근거로 한다. 기본 어휘·패키지 규칙은 [ECMA-376](https://ecma-international.org/publications-and-standards/standards/ecma-376/)을 따른다.

## 결과

- 장점: 입력 결함과 변환기 손실을 분리하고, 복구 내역을 UI·테스트에서 재사용한다.
- 비용: 브라우저 DOM 정규화가 추가되고, 복구 카탈로그를 스키마 근거와 함께 유지해야 한다.
- 기각: XML 문자열 치환만으로 고침 — 네임스페이스·자식 순서를 안전하게 다루지 못한다.

