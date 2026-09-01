# ADR 0003 — 다축 충실도 QA

- 상태: 승인
- 일자: 2026-09-01

## 맥락

HWPX는 XML이 well-formed이고 IDRef가 맞아도 한컴이 일부 요소를 조용히 무시할 수 있다. 반대로 페이지 수 차이만으로 실패를 판단하면 Word와 한컴의 배치 엔진 차이를 오판한다.

## 결정

품질을 네 축으로 분리한다.

1. 입력 감사: 결함 코드와 자동 복구 내역
2. 구조 보존: 문단·표·행·셀·수동 줄바꿈 수
3. 패키지 무결성: XML/IDRef/표 격자/CRC32
4. 시각 검수: 한컴 PDF 전수 렌더 contact sheet

HWPX가 OWPML/KS X 6101 기반 XML 패키지라는 근거는 [한컴 공개 자료](https://notice.hancom.com/support/downloadCenter/hwpOwpml)와 [한컴테크 설명](https://tech.hancom.com/hwpxformat/)을 따른다.

## 결과

- 고정된 “DOCX 변환률 85%”는 현재 품질 표시에서 제거하고 파일별 실측 진단으로 대체한다.
- 자동 게이트 통과만으로 릴리스하지 않는다.
- 페이지 수는 관찰값으로 기록하되 단독 합격 기준으로 쓰지 않는다.
