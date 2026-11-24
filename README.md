# ZETA Tools Android Preview 0.1.0

제타 공식 앱이 아닌 독립 웹뷰 테스트용 앱입니다. 기존 공개 스크립트 main 브랜치는 수정하지 않습니다.

## 테스트 APK
Actions → Android APK Preview → 최신 성공 실행 → Artifacts → ZETA-Tools-Android-0.1.0-preview ZIP → app-debug.apk.
GitHub 로그인 필요. 이 APK는 테스트용 debug 서명이며, 다음 빌드에서 같은 서명을 보장하지 않으므로 공개 배포 또는 데이터 보존 업데이트용이 아닙니다.

## 기능
- 제타 공식 웹 접속, 쿠키 및 사이트 저장소 유지
- 우측 상단 ⋮ 설정, 기본/확장/전체화면
- 공개 카카오톡 테마 기본 활성화, 캡처 이름 가리기/방 관리/대화 검색 선택
- AndroidX WebKit document-start injection: 공식 웹과 채팅 프레임 출처만 허용
- GitHub 공개 main의 스크립트 최신 버전 확인 및 로컬 캐시, 실패 시 기존 버전 유지
- 화면 켜짐 유지, 새로고침, 외부 브라우저 열기
- APK 출시 태그 android-vX.Y.Z 확인 (설치는 사용자 승인 필요)

## 제한
실기기 테스트 전입니다. Google/카카오/Apple 로그인, 외부 인증 후 세션 복귀, iframe 동작, 키보드, 이미지/Blob 파일 저장은 검증 필요. 오토엔터는 비공개 저장소에 있으므로 이 공개 브랜치에 포함하지 않습니다. 전체 대화 내보내기는 Blob 다운로드 지원을 추가한 뒤 연동해야 합니다. 제타 웹 자체 제한을 우회하지 않습니다. 앱은 별도 계정정보 수집/전송 기능을 넣지 않았습니다. 공개 스크립트 자동 갱신은 해당 저장소의 코드를 신뢰하는 기능이므로 설정에서 끌 수 있습니다.

## 배포판
실기기 확인 후 안정적인 release signing key를 별도로 생성 및 안전하게 보관하고 GitHub Actions Secrets 등으로 관리합니다. 동일한 applicationId 및 signing key, 증가하는 versionCode로 릴리스 APK를 빌드하여 android-vX.Y.Z 태그의 GitHub Release에 APK를 첨부합니다. 현재 preview 빌드는 릴리스를 자동 공개하지 않습니다. 앱스토어/공개 배포 이전 제타 이용약관 및 브랜드 권한 확인.
