#!/usr/bin/env python3
"""
validate_hwpx.py
생성된 .hwpx가 한글에서 열리는 데 필요한 구조 요건을 4개 영역으로 검증함.
PASS/FAIL과 실패 사유를 출력하고, 실패 시 종료코드 1을 반환함.

검증 영역:
  1. 컨테이너  - mimetype 첫 항목·무압축·내용, META-INF 3종
  2. 필수 파일 - Contents/header.xml·section0.xml, Preview/PrvText.txt
  3. XML 적합성 - section0.xml well-formed + 네임스페이스
  4. 참조 무결성 - charPrIDRef가 header에 정의됨

사용: python validate_hwpx.py document.hwpx
"""
import sys
import zipfile
import xml.etree.ElementTree as ET

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"


def check_container(zf):
    issues = []
    names = zf.namelist()
    if not names or names[0] != "mimetype":
        issues.append("mimetype이 ZIP 첫 항목이 아님 (한글이 손상 파일로 인식)")
    info = zf.getinfo("mimetype") if "mimetype" in names else None
    if info is None:
        issues.append("mimetype 파일 없음")
    else:
        if info.compress_type != zipfile.ZIP_STORED:
            issues.append("mimetype이 압축됨 (ZIP_STORED 아님)")
        content = zf.read("mimetype").decode("utf-8", "ignore").strip()
        if content != "application/hwp+zip":
            issues.append(f"mimetype 내용 불일치: '{content}'")
    for req in ["META-INF/container.xml", "META-INF/container.rdf", "META-INF/manifest.xml"]:
        if req not in names:
            issues.append(f"필수 메타파일 누락: {req}")
    return issues


def check_required_files(zf):
    issues = []
    names = zf.namelist()
    for req in ["Contents/header.xml", "Contents/section0.xml", "Preview/PrvText.txt"]:
        if req not in names:
            issues.append(f"필수 파일 누락: {req}")
    return issues


def check_xml_wellformed(zf):
    issues = []
    names = zf.namelist()
    for xmlfile in ["Contents/section0.xml", "Contents/header.xml", "META-INF/container.xml"]:
        if xmlfile not in names:
            continue
        try:
            ET.fromstring(zf.read(xmlfile))
        except ET.ParseError as e:
            issues.append(f"{xmlfile} XML 파싱 오류: {e}")
    # section0 네임스페이스 확인
    if "Contents/section0.xml" in names:
        data = zf.read("Contents/section0.xml").decode("utf-8", "ignore")
        if "hancom.co.kr/hwpml/2011/section" not in data:
            issues.append("section0.xml에 section 네임스페이스 선언 없음")
        if "hancom.co.kr/hwpml/2011/paragraph" not in data:
            issues.append("section0.xml에 paragraph 네임스페이스 선언 없음")
    return issues


def check_ref_integrity(zf):
    issues = []
    names = zf.namelist()
    if "Contents/header.xml" not in names or "Contents/section0.xml" not in names:
        return issues  # 이미 필수파일 검사에서 잡힘
    header = zf.read("Contents/header.xml").decode("utf-8", "ignore")
    section = zf.read("Contents/section0.xml").decode("utf-8", "ignore")

    # header에 정의된 charPr id 수집
    import re
    defined_char = set(re.findall(r'<hh:charPr id="(\d+)"', header))
    used_char = set(re.findall(r'charPrIDRef="(\d+)"', section))
    missing = used_char - defined_char
    if missing:
        issues.append(f"section이 참조하는 charPr가 header에 미정의: {sorted(missing)}")

    defined_para = set(re.findall(r'<hh:paraPr id="(\d+)"', header))
    used_para = set(re.findall(r'paraPrIDRef="(\d+)"', section))
    missing_p = used_para - defined_para
    if missing_p:
        issues.append(f"section이 참조하는 paraPr가 header에 미정의: {sorted(missing_p)}")
    return issues


def main():
    if len(sys.argv) < 2:
        print("사용법: python validate_hwpx.py document.hwpx")
        return 2
    path = sys.argv[1]

    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        print(f"{FAIL} 유효한 ZIP/HWPX 파일이 아님: {path}")
        return 1

    checks = [
        ("1. 컨테이너 구조", check_container),
        ("2. 필수 파일", check_required_files),
        ("3. XML 적합성", check_xml_wellformed),
        ("4. 참조 무결성", check_ref_integrity),
    ]

    print(f"\n검증 대상: {path}\n" + "=" * 50)
    total_issues = 0
    with zf:
        for label, fn in checks:
            issues = fn(zf)
            if issues:
                total_issues += len(issues)
                print(f"{FAIL}  {label}")
                for it in issues:
                    print(f"       └ {it}")
            else:
                print(f"{PASS}  {label}")
    print("=" * 50)
    if total_issues == 0:
        print(f"{PASS}  종합: 4개 영역 모두 통과 — 한글 호환 구조 충족\n")
        return 0
    else:
        print(f"{FAIL}  종합: {total_issues}건 문제 — 복구 필요\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
