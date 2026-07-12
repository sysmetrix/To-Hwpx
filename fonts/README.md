# Fonts

이 폴더는 HWPX 출력에 사용할 폰트를 사용자가 직접 내려받아 둘 수 있는 위치입니다.

앱은 아래 파일 중 하나가 있으면 **폰트 설치 안내** 팝업에 로컬 다운로드 버튼을 표시합니다.

| 폰트 | 기본 경로 | 현재 Font 폴더 호환 경로 |
|---|---|---|
| Noto Sans KR | `fonts/NotoSansKR-Regular.ttf` | `Font/NotoSansKR-Regular.ttf` |
| 나눔고딕 | `fonts/NanumGothic.ttf` | `Font/NanumGothic.ttf` |
| KoPub돋움체 | `fonts/KoPubWorldDotum-Medium.ttf` | `Font/KoPubDotumMedium.ttf` |
| Pretendard GOV Variable | `fonts/PretendardGOVVariable.ttf` | - |

주의: HWPX 파일에는 폰트 파일이 임베딩되지 않습니다. 한컴오피스에서 같은 폰트로 보려면 사용자의 PC에 해당 TTF/OTF를 설치해야 합니다.

Pretendard GOV는 PC와 설치 방식에 따라 한컴에 `Pretendard GOV Variable` 또는 `Pretendard GOV`로 등록될 수 있습니다. 앱은 변환 직전에 실제 설치명을 감지해 그 이름을 HWPX 주 글꼴로 기록하고, 반대 이름을 대체 글꼴로 함께 기록합니다. 감지할 수 없으면 배포 파일의 내부 패밀리명인 `Pretendard GOV Variable`을 사용합니다.

Noto Sans KR, 나눔고딕, Pretendard GOV는 `OFL-1.1.txt`와 루트 `THIRD_PARTY_NOTICES.md`의 고지에 따라 운영 배포합니다. KoPubWorld돋움은 재배포 조건의 최종 운영 확인 전까지 `.vercelignore`와 Pages 배포 allowlist에서 제외하며 앱은 공식 사이트 링크만 안내합니다.
