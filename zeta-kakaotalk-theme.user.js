// ==UserScript==
// @name         Zeta KakaoTalk Theme
// @namespace    zeta-kakaotalk-theme
// @version      3.49.0
// @description  Zeta 카카오톡 테마 (일기, 엔딩, 선택지, 신고, 수정 UI, 대화 프로필 및 인스타그램풍 제타그램)
// @match        https://zeta-ai.io/*
// @updateURL    https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-kakaotalk-theme.user.js
// @downloadURL  https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/zeta-kakaotalk-theme.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * 유지보수 지도 (실행에는 영향을 주지 않는 주석)
 *
 * 1. CSS 테마 정의                 const CSS
 *    - 채팅, 프로필, 책갈피, 저장 대화, 스냅샷
 *    - 일기, 엔딩, 선택지, 신고/수정 UI
 *    - 제타그램, 익명 게시판
 *
 * 2. 화면 상태 판별                isExactChatRoom() 부근부터
 *    - 현재 주소와 화면 요소를 기준으로 활성 화면을 구분
 *
 * 3. 요소 표시용 클래스 관리       clearMarkersOutsideChat() 부근부터
 *    - Zeta의 동적 요소에 kt-* 클래스를 붙이거나 제거
 *
 * 4. 전체 적용 흐름                apply()
 *    - 화면 상태 갱신 후 각 화면별 표시 함수를 실행
 *
 * 5. 화면 변경 감지                scheduleApply(), patchHistory(), start()
 *    - 페이지 이동과 동적 화면 변경 시 테마를 다시 적용
 *
 * 안전 규칙
 * - CSS 규칙의 순서는 우선순위의 일부이므로 이동하지 않는다.
 * - 같은 규칙처럼 보여도 뒤쪽 보정 규칙을 임의로 합치지 않는다.
 * - kt-* 클래스의 추가/제거 순서도 화면 상태에 영향을 줄 수 있다.
 */

(() => {
  'use strict';

  const STYLE_ID = 'zeta-kakaotalk-theme-style';
  const ACTIVE = 'kt-chat-theme-active';
  const PROFILE_EDIT_ACTIVE = 'kt-profile-edit-active';
  const BOOKMARK_ACTIVE = 'kt-bookmark-active';
  const SAVED_ROOMS_ACTIVE = 'kt-saved-rooms-active';
  const SAVED_ROOM_ACTIVE = 'kt-saved-room-active';
  const DIARY_ACTIVE = 'kt-diary-active';
  const ENDING_ACTIVE = 'kt-ending-active';

  const CSS = `
    :root {
      --kt-yellow: #FEE500;
      --kt-yellow-hover: #F5DC00;
      --kt-chat: #B2C7D9;

      --kt-white: #FFFFFF;
      --kt-soft: #F5F5F5;
      --kt-soft2: #EFEFEF;

      --kt-text: #191919;
      --kt-sub: #666666;
      --kt-muted: #999999;
      --kt-line: #E7E7E7;

      --kt-ai-name: #52606B;
      --kt-ai-dialogue: #202124;
      --kt-ai-action: #67747D;

      --kt-user-name: #645C38;
      --kt-user-dialogue: #191919;
      --kt-user-action: #756C38;

      --kt-meta-bg: rgba(255,255,255,.62);
      --kt-meta-title: #46545E;
      --kt-meta-text: #64717A;
    }

    /* =========================================================
       중요: 아래 모든 스타일은 채팅방 활성 클래스 안에서만 적용
    ========================================================= */

    html.${ACTIVE},
    html.${ACTIVE} body {
      background: var(--kt-chat) !important;
      color: var(--kt-text) !important;
      color-scheme: light !important;
    }

    html.${ACTIVE} main#contents,
    html.${ACTIVE} [role="log"][aria-label="Chat messages"] {
      background: var(--kt-chat) !important;
    }

    /* 상단 헤더
       중요: nav에는 흰 배경을 주지 않음.
       nav의 py-4가 header 높이 밖으로 넘치기 때문에
       nav까지 흰색이면 아래쪽에 흰 띠가 생김. */
    html.${ACTIVE} main#contents header {
      background: var(--kt-white) !important;
      color: var(--kt-text) !important;
      border-color: var(--kt-line) !important;
    }

    html.${ACTIVE} main#contents header nav {
      background: transparent !important;
      color: var(--kt-text) !important;
    }

    html.${ACTIVE} .kt-chat-header-layer {
      background: var(--kt-chat) !important;
      color: var(--kt-text) !important;
      border-color: var(--kt-line) !important;
    }

    html.${ACTIVE} button[aria-label="Go back"],
    html.${ACTIVE} button[aria-label="Open chat menu"],
    html.${ACTIVE} [data-testid="chat-header-profile"] {
      background: transparent !important;
      color: var(--kt-text) !important;
      border: 0 !important;
    }

    html.${ACTIVE} button[aria-label="Go back"] svg,
    html.${ACTIVE} button[aria-label="Open chat menu"] svg,
    html.${ACTIVE} [data-testid="chat-header-profile"] span {
      color: var(--kt-text) !important;
    }

    html.${ACTIVE} [data-testid="chat-header-model"] {
      background: var(--kt-soft) !important;
      color: var(--kt-text) !important;
      border: 1px solid var(--kt-line) !important;
    }

    html.${ACTIVE} [data-testid="chat-header-model"] svg {
      color: var(--kt-sub) !important;
    }

    /* 안내 문구 */
    html.${ACTIVE} [data-sentry-component="FirstGuide"] > div {
      background: rgba(255,255,255,.76) !important;
      color: #56636D !important;
      border: 1px solid rgba(0,0,0,.04) !important;
    }

    html.${ACTIVE} [data-sentry-component="FirstGuide"] svg {
      color: #56636D !important;
    }

    /* 상대 / 유저 이름 */
    html.${ACTIVE} [data-sentry-component="LeftTextContent"] .caption1 {
      color: var(--kt-ai-name) !important;
    }

    html.${ACTIVE} [data-sentry-component="RightTextContent"] .caption1 {
      color: var(--kt-user-name) !important;
    }

    /* 상대 말풍선 */
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other {
      background: var(--kt-white) !important;
      color: var(--kt-ai-dialogue) !important;
      border: 0 !important;
      box-shadow: 0 1px 2px rgba(0,0,0,.05) !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other p {
      color: var(--kt-ai-dialogue) !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other em {
      color: var(--kt-ai-action) !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other em [class*="text-primary-"],
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other em [data-placeholder] {
      color: var(--kt-ai-action) !important;
    }

    /* 내 말풍선 */
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me {
      background: var(--kt-yellow) !important;
      color: var(--kt-user-dialogue) !important;
      border: 0 !important;
      box-shadow: 0 1px 2px rgba(0,0,0,.05) !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me p {
      color: var(--kt-user-dialogue) !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me em {
      color: var(--kt-user-action) !important;
    }

    /* **강조** */
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat strong,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat b,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat .font-bold {
      color: #514A27 !important;
      font-weight: 700 !important;
    }

    /* Zeta 기본 보라색 토큰 제거 */
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me [class*="text-primary-"],
    html.${ACTIVE} [data-sentry-component="RightTextContent"] [data-placeholder] {
      color: inherit !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me em [class*="text-primary-"],
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me em [data-placeholder] {
      color: var(--kt-user-action) !important;
    }

    /* 내레이션
       긴 내레이터가 화면을 큰 박스로 덮지 않도록 배경/테두리 제거 */
    html.${ACTIVE} [data-sentry-component="NarratorBubble"] > div {
      background: transparent !important;
      color: var(--kt-meta-text) !important;
      border: 0 !important;
      box-shadow: none !important;
      padding-top: 2px !important;
      padding-bottom: 2px !important;
    }

    html.${ACTIVE} [data-sentry-component="NarratorBubble"] .chat,
    html.${ACTIVE} [data-sentry-component="NarratorBubble"] p,
    html.${ACTIVE} [data-sentry-component="NarratorBubble"] em,
    html.${ACTIVE} [data-sentry-component="NarratorBubble"] li,
    html.${ACTIVE} [data-sentry-component="NarratorBubble"] strong {
      color: var(--kt-meta-text) !important;
    }

    html.${ACTIVE} [data-sentry-component="NarratorBubble"] strong {
      color: var(--kt-meta-title) !important;
    }

    html.${ACTIVE} [data-sentry-component="NarratorBubble"] hr {
      border-color: rgba(70,84,94,.28) !important;
    }

    html.${ACTIVE} [data-sentry-component="NarratorBubble"] svg {
      color: var(--kt-meta-title) !important;
    }

    /* 정보박스 */
    html.${ACTIVE} [data-sentry-component="InfoBoxContent"][class*="mx-2"] {
      background: var(--kt-meta-bg) !important;
      color: var(--kt-meta-text) !important;
      border: 1px solid rgba(70,84,94,.08) !important;
    }

    html.${ACTIVE} [data-sentry-component="InfoBoxContent"][class*="mx-2"] .font-bold,
    html.${ACTIVE} [data-sentry-component="InfoBoxContent"][class*="mx-2"] .font-semibold {
      color: var(--kt-meta-title) !important;
    }

    html.${ACTIVE} [data-sentry-component="InfoBoxContent"][class*="mx-2"] [class*="text-white/"],
    html.${ACTIVE} [data-sentry-component="InfoBoxContent"][class*="mx-2"] .chat {
      color: var(--kt-meta-text) !important;
    }

    html.${ACTIVE} [data-sentry-component="InfoBoxContent"][class*="mx-2"] svg {
      color: var(--kt-meta-title) !important;
    }

    /* =========================================================
       상단바 아래 spacer
       높이는 유지하고 색만 채팅 배경으로 연결
    ========================================================= */
    html.${ACTIVE} .kt-top-spacer {
      background: var(--kt-chat) !important;
    }


    /* =========================================================
       맨 아래로 이동 버튼
    ========================================================= */
    html.${ACTIVE} [data-testid="chat-scroll-to-bottom"] {
      width: 34px !important;
      height: 34px !important;
      background: rgba(255,255,255,.94) !important;
      color: #455761 !important;
      border: 1px solid rgba(69,87,97,.16) !important;
      box-shadow: 0 2px 8px rgba(40,55,65,.18) !important;
      backdrop-filter: blur(6px);
    }

    html.${ACTIVE} [data-testid="chat-scroll-to-bottom"]:hover {
      background: #FFFFFF !important;
      box-shadow: 0 3px 10px rgba(40,55,65,.22) !important;
    }

    html.${ACTIVE} [data-testid="chat-scroll-to-bottom"] svg {
      color: #455761 !important;
    }


    /* =========================================================
       마크다운 - 상대 말풍선
    ========================================================= */

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat strong,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat b,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat .font-bold {
      color: #30414B !important;
      font-weight: 700 !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat code {
      color: #30414B !important;
      background: #EEF2F4 !important;
      border: 1px solid rgba(48,65,75,.10) !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat blockquote {
      color: #455B68 !important;
      background: rgba(178,199,217,.20) !important;
      border-radius: 6px !important;
      padding-top: 4px !important;
      padding-bottom: 4px !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat blockquote p {
      color: #455B68 !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat blockquote > div:first-child {
      background: #8097A6 !important;
      width: 3px !important;
      border-radius: 999px !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat a {
      color: #35617D !important;
      text-decoration: underline !important;
      text-underline-offset: 2px;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat del,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat s {
      color: #87939A !important;
      text-decoration-color: #87939A !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat h1,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat h2,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat h3,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat h4,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat h5,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat h6 {
      color: #2D3C45 !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat hr {
      border-color: #CDD6DB !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat li,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-other .chat li > span[aria-hidden="true"] {
      color: #3D4E58 !important;
    }


    /* =========================================================
       마크다운 - 내 말풍선
       노란 배경 위에서 명령별 차이가 보이도록 분리
    ========================================================= */

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat strong,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat b,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat .font-bold {
      color: #493D08 !important;
      font-weight: 750 !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat code {
      color: #433A13 !important;
      background: rgba(255,255,255,.52) !important;
      border: 1px solid rgba(73,61,8,.12) !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat blockquote {
      color: #584D20 !important;
      background: rgba(255,255,255,.28) !important;
      border-radius: 6px !important;
      padding-top: 4px !important;
      padding-bottom: 4px !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat blockquote p {
      color: #584D20 !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat blockquote > div:first-child {
      background: #83742D !important;
      width: 3px !important;
      border-radius: 999px !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat a {
      color: #5A4C00 !important;
      text-decoration: underline !important;
      text-underline-offset: 2px;
      font-weight: 600 !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat del,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat s {
      color: #857A49 !important;
      text-decoration-color: #756A37 !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat h1,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat h2,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat h3,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat h4,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat h5,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat h6 {
      color: #443900 !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat hr {
      border-color: rgba(73,61,8,.25) !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat li,
    html.${ACTIVE} [data-sentry-component="ChatBubbleContainer"].kt-me .chat li > span[aria-hidden="true"] {
      color: #4D431C !important;
    }


    /* =========================================================
       마크다운 - 내레이터
    ========================================================= */

    html.${ACTIVE} [data-sentry-component="NarratorBubble"] code {
      color: #40515B !important;
      background: rgba(255,255,255,.46) !important;
      border: 1px solid rgba(64,81,91,.10) !important;
    }

    html.${ACTIVE} [data-sentry-component="NarratorBubble"] blockquote {
      color: #52636C !important;
      background: rgba(255,255,255,.22) !important;
      border-radius: 6px !important;
      padding-top: 4px !important;
      padding-bottom: 4px !important;
    }

    html.${ACTIVE} [data-sentry-component="NarratorBubble"] blockquote > div:first-child {
      background: #8197A4 !important;
      width: 3px !important;
      border-radius: 999px !important;
    }

    html.${ACTIVE} [data-sentry-component="NarratorBubble"] a {
      color: #355E78 !important;
      text-decoration: underline !important;
    }

    html.${ACTIVE} [data-sentry-component="NarratorBubble"] del,
    html.${ACTIVE} [data-sentry-component="NarratorBubble"] s {
      color: #859199 !important;
    }


    /* =========================================================
       프로필 선택 화면
    ========================================================= */

    html.${ACTIVE} [data-sentry-component="PlayerCharacterSelect"] {
      background: transparent !important;
      color: var(--kt-text) !important;
    }

    html.${ACTIVE} [data-sentry-component="PlayerCharacterSelect"] > h4 {
      color: #26343C !important;
    }

    /* 가로 프로필 캐러셀 스크롤바 */
    html.${ACTIVE} [data-sentry-component="PlayerCharacterSelect"] > div[class*="overflow-x-auto"] {
      scrollbar-width: thin !important;
      scrollbar-color: rgba(67,85,96,.20) transparent !important;
    }

    html.${ACTIVE} [data-sentry-component="PlayerCharacterSelect"] > div[class*="overflow-x-auto"]::-webkit-scrollbar {
      height: 5px !important;
    }

    html.${ACTIVE} [data-sentry-component="PlayerCharacterSelect"] > div[class*="overflow-x-auto"]::-webkit-scrollbar-thumb {
      background: rgba(67,85,96,.20) !important;
      border-radius: 999px !important;
    }

    /* 현재 선택/미리보기 카드 */
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      border-color: #D8E0E5 !important;
      box-shadow: 0 4px 14px rgba(55,74,84,.12) !important;
    }

    /* 다크용 블러 배경 + 검은 오버레이 제거 */
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] > div.absolute.inset-0 {
      display: none !important;
    }

    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] h4 {
      color: #26343C !important;
    }

    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] .body16,
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] .caption1 {
      color: #687780 !important;
    }

    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] button[aria-label="Edit chat profile"] {
      background: #F0F2F3 !important;
      color: #53636C !important;
      border: 1px solid #E0E5E8 !important;
    }

    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] button[aria-label="Edit chat profile"] svg {
      color: #53636C !important;
    }

    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] .kt-profile-select-button {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E7D000 !important;
    }

    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] .kt-profile-select-button:hover {
      background: var(--kt-yellow-hover) !important;
    }

    /* 내 프로필 목록 카드 */
    html.${ACTIVE} [data-sentry-component="PlayerCharacterSelect"]
      div:has(> [role="group"][aria-label="My chat profiles"]) {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      border-color: #D8E0E5 !important;
      box-shadow: 0 4px 14px rgba(55,74,84,.10) !important;
    }

    html.${ACTIVE} [role="group"][aria-label="My chat profiles"] {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
    }

    html.${ACTIVE} [role="group"][aria-label="My chat profiles"] > button:first-child {
      color: #394A54 !important;
      background: #F8F9FA !important;
      border-bottom: 1px solid var(--kt-line) !important;
    }

    html.${ACTIVE} [role="group"][aria-label="My chat profiles"] > button:first-child > div {
      background: #EEF1F3 !important;
    }

    html.${ACTIVE} [role="group"][aria-label="My chat profiles"] > button:first-child svg {
      color: #53636C !important;
    }

    html.${ACTIVE} [role="group"][aria-label="My chat profiles"] > div > div {
      border-bottom: 1px solid #EEF1F3 !important;
    }

    html.${ACTIVE} [role="group"][aria-label="My chat profiles"] button {
      color: var(--kt-text) !important;
    }

    html.${ACTIVE} [role="group"][aria-label="My chat profiles"] button:hover {
      background: #F7F8F9 !important;
    }

    html.${ACTIVE} [role="group"][aria-label="My chat profiles"] .body1 {
      color: #26343C !important;
    }

    html.${ACTIVE} [role="group"][aria-label="My chat profiles"] .caption1 {
      color: #7A878E !important;
    }

    html.${ACTIVE} [role="group"][aria-label="My chat profiles"] button[aria-label="Edit chat profile"] svg {
      color: #7A878E !important;
    }

    /* 입력 영역 */
    html.${ACTIVE} [data-sentry-component="ChatComposer"] {
      background: var(--kt-white) !important;
      color: var(--kt-text) !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatComposer"] > div:last-child {
      background: var(--kt-white) !important;
      border-top-color: var(--kt-line) !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatComposer"] .kt-composer-box {
      background: var(--kt-soft) !important;
      border: 1px solid #E9E9E9 !important;
    }

    html.${ACTIVE} textarea[aria-label="내용 입력하기"] {
      background: transparent !important;
      color: var(--kt-text) !important;
      caret-color: #333 !important;
      border: 0 !important;
    }

    html.${ACTIVE} textarea[aria-label="내용 입력하기"]::placeholder {
      color: var(--kt-muted) !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} button[aria-label="Insert asterisk"] {
      background: transparent !important;
      color: var(--kt-sub) !important;
    }

    html.${ACTIVE} button[aria-label="Insert asterisk"] svg {
      color: var(--kt-sub) !important;
    }

    html.${ACTIVE} button[aria-label="Suggested replies"] {
      background: transparent !important;
    }

    html.${ACTIVE} button[aria-label="Suggested replies"] > span {
      background: var(--kt-soft2) !important;
    }

    html.${ACTIVE} button[aria-label="Suggested replies"] svg,
    html.${ACTIVE} [data-sentry-component="QuickReplyButton"] > span {
      color: var(--kt-sub) !important;
    }

    html.${ACTIVE} [data-testid="chat-send-button"] {
      background: var(--kt-yellow) !important;
      color: var(--kt-text) !important;
      border: 0 !important;
    }

    html.${ACTIVE} [data-testid="chat-send-button"]:hover {
      background: var(--kt-yellow-hover) !important;
    }

    html.${ACTIVE} [data-testid="chat-send-button"] svg {
      color: var(--kt-text) !important;
    }

    html.${ACTIVE} [data-testid="chat-send-button"]:disabled {
      background: #EAEAEA !important;
      color: #AAAAAA !important;
    }

    /* 이미지 보호 */
    html.${ACTIVE} img,
    html.${ACTIVE} picture,
    html.${ACTIVE} video,
    html.${ACTIVE} canvas {
      filter: none !important;
    }

    /* 채팅 메시지 스크롤바 숨김
       스크롤 기능 자체는 유지됨 */
    html.${ACTIVE} [role="log"][aria-label="Chat messages"] {
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }

    html.${ACTIVE} [role="log"][aria-label="Chat messages"]::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
    }

    /* 추천 답변 버튼 아래 '무료' 라벨 제거 */
    html.${ACTIVE} [data-sentry-component="QuickReplyButton"] > span {
      display: none !important;
    }

    /* 스냅샷 버튼 본체에는 배경을 주지 않음 */
    html.${ACTIVE} [data-testid="snapshot-action-button"] {
      background: transparent !important;
      color: var(--kt-text) !important;
    }

    /* 스냅샷 아이콘 원 */
    html.${ACTIVE} [data-testid="snapshot-action-button"] > span:first-child {
      display: flex !important;
      background: #EEF1F3 !important;
      color: #53636C !important;
    }

    html.${ACTIVE} [data-testid="snapshot-action-button"] > span:nth-child(2) {
      display: block !important;
      color: #394A54 !important;
    }

    html.${ACTIVE} [data-testid="snapshot-action-button"] svg {
      color: #53636C !important;
    }

    /* 추천 답변 아이콘 */
    html.${ACTIVE} button[aria-label="Suggested replies"] > span {
      background: var(--kt-soft2) !important;
      color: var(--kt-sub) !important;
    }

    html.${ACTIVE} button[aria-label="Suggested replies"] svg {
      color: var(--kt-sub) !important;
    }

    /* =========================================================
       v3.8 - 상단바 아래 흰 띠 완전 제거
       실제 header만 흰색, 그 바깥 레이어는 채팅 배경
    ========================================================= */

    html.${ACTIVE} .kt-chat-header-layer > header,
    html.${ACTIVE} .kt-chat-header-layer > header nav {
      background: var(--kt-white) !important;
    }

    html.${ACTIVE} .kt-top-spacer,
    html.${ACTIVE} div[class*="h-[calc(52px_"] {
      background-color: var(--kt-chat) !important;
    }


    /* =========================================================
       v3.8 - 프로필 이미지 하단 그라데이션 제거
       Zeta가 View image 버튼에 inline mask를 넣으므로 강제로 해제
    ========================================================= */

    html.${ACTIVE} [data-sentry-component="PlotProfileCard"]
      button[aria-label="View image"] {
      mask: none !important;
      -webkit-mask: none !important;
    }

    html.${ACTIVE} [data-sentry-component="PlotProfileCard"]
      button[aria-label="View image"] img {
      mask: none !important;
      -webkit-mask: none !important;
    }



    /* =========================================================
       v3.9 - 상단 흰 띠 진짜 원인 수정
       nav의 py-4가 header 높이 아래로 넘치므로
       nav 배경은 투명하게 하고 header만 흰색 유지
    ========================================================= */

    html.${ACTIVE} .kt-chat-header-layer {
      background: var(--kt-chat) !important;
    }

    html.${ACTIVE} .kt-chat-header-layer > header {
      background: var(--kt-white) !important;
    }

    html.${ACTIVE} .kt-chat-header-layer > header nav {
      background: transparent !important;
    }

    html.${ACTIVE} .kt-top-spacer,
    html.${ACTIVE} div[class*="h-[calc(52px_"] {
      background: var(--kt-chat) !important;
    }


    /* =========================================================
       v3.9 - 프로필 이미지 그라데이션 복구
       Zeta 원래 mask를 그대로 되살림
    ========================================================= */

    html.${ACTIVE} [data-sentry-component="PlotProfileCard"]
      button[aria-label="View image"] {
      mask: linear-gradient(
        rgb(255,255,255) 0%,
        rgb(255,255,255) 80%,
        rgba(255,255,255,0) 100%
      ) !important;

      -webkit-mask: linear-gradient(
        rgb(255,255,255) 0%,
        rgb(255,255,255) 80%,
        rgba(255,255,255,0) 100%
      ) !important;
    }


    /* =========================================================
       v3.9 - 상단 AI 모델 선택 버튼
       흰 헤더에서 로고가 묻히지 않게 블루그레이 pill
    ========================================================= */

    html.${ACTIVE} [data-testid="chat-header-model"] {
      background: #667B88 !important;
      border: 1px solid #5D727F !important;
      color: #FFFFFF !important;
      box-shadow: 0 1px 2px rgba(35,52,62,.12) !important;
    }

    html.${ACTIVE} [data-testid="chat-header-model"]:hover {
      background: #5E737F !important;
    }

    html.${ACTIVE} [data-testid="chat-header-model"] svg {
      color: rgba(255,255,255,.88) !important;
    }

    html.${ACTIVE} [data-testid="chat-header-model"] img {
      filter: none !important;
      opacity: 1 !important;
    }


    /* v3.10 safety: #contents가 포함된 기존/사이트 규칙보다 확실히 우선 */
    html.${ACTIVE} main#contents .kt-chat-header-layer > header nav {
      background: transparent !important;
    }

    html.${ACTIVE} main#contents .kt-chat-header-layer {
      background: var(--kt-chat) !important;
    }

    html.${ACTIVE} main#contents .kt-chat-header-layer > header {
      background: var(--kt-white) !important;
    }


    /* =========================================================
       v3.11 - 하단 액션 패널
       스냅샷 / 메시지
    ========================================================= */

    html.${ACTIVE} #portal-container .kt-action-backdrop {
      background: rgba(31, 43, 50, .34) !important;
    }

    html.${ACTIVE} #portal-container .kt-action-sheet {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      border-top: 1px solid #E3E8EB !important;
      box-shadow: 0 -8px 24px rgba(39, 55, 64, .12) !important;
    }

    /* 위쪽 드래그 손잡이 */
    html.${ACTIVE} #portal-container .kt-action-sheet > div:first-child svg {
      color: #CBD3D8 !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="Chat actions"] {
      background: transparent !important;
      color: var(--kt-text) !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="action-panel-grid"] {
      background: transparent !important;
    }

    /* 두 액션 버튼 공통 */
    html.${ACTIVE} #portal-container
      [data-testid="action-panel-grid"] > button {
      background: transparent !important;
      color: #394A54 !important;
      border-radius: 12px !important;
      padding: 8px 4px !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="action-panel-grid"] > button:hover {
      background: #F7F9FA !important;
    }

    /* 스냅샷 아이콘 */
    html.${ACTIVE} #portal-container
      [data-testid="snapshot-action-button"] > span:first-child {
      background: #EEF1F3 !important;
      color: #53636C !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="snapshot-action-button"] > span:nth-child(2) {
      color: #394A54 !important;
    }

    /* 메시지 버튼 */
    html.${ACTIVE} #portal-container
      button[aria-label^="메시지"] > span:first-child {
      background: var(--kt-yellow) !important;
      color: var(--kt-text) !important;
    }

    html.${ACTIVE} #portal-container
      button[aria-label^="메시지"] > span:first-child svg {
      color: #2B2B2B !important;
    }

    html.${ACTIVE} #portal-container
      button[aria-label^="메시지"] > span:last-child {
      color: #394A54 !important;
    }

    /* 메시지 새 알림 점 */
    html.${ACTIVE} #portal-container
      [data-testid="message-plugin-unread-dot"] {
      background: #FF5C5C !important;
      box-shadow: 0 0 0 2px #FFFFFF !important;
    }


    /* =========================================================
       v3.12 - 채팅 우측 사이드 메뉴
    ========================================================= */

    /* 바깥 딤 */
    html.${ACTIVE} [data-sentry-component="ChatSidebar"] {
      background: rgba(43, 57, 66, .30) !important;
    }

    /* 실제 메뉴 패널 */
    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      [role="dialog"][aria-label="Chat menu"] {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      border-left: 1px solid #DDE4E8 !important;
      box-shadow: -10px 0 28px rgba(38, 52, 61, .14) !important;
    }

    /* 메뉴 스크롤 영역 */
    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      [role="dialog"][aria-label="Chat menu"] > div:first-child {
      background: #FFFFFF !important;
      scrollbar-color: rgba(70, 88, 99, .20) transparent !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      [role="dialog"][aria-label="Chat menu"] > div:first-child::-webkit-scrollbar {
      width: 5px !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      [role="dialog"][aria-label="Chat menu"] > div:first-child::-webkit-scrollbar-thumb {
      background: rgba(70, 88, 99, .20) !important;
      border-radius: 999px !important;
    }

    /* 피스 잔액 카드 */
    html.${ACTIVE} [data-sentry-component="SidebarPieceBalance"] {
      background: #F3F5F6 !important;
      color: var(--kt-text) !important;
      border: 1px solid #E3E8EB !important;
    }

    html.${ACTIVE} [data-sentry-component="SidebarPieceBalance"] .heading3 {
      color: #26343C !important;
    }

    /* 충전 = 카톡 포인트 */
    html.${ACTIVE} [data-sentry-component="SidebarPieceBalance"] button {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E6D000 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} [data-sentry-component="SidebarPieceBalance"] button:hover {
      background: var(--kt-yellow-hover) !important;
    }

    /* 스냅샷 보관함 제목 */
    html.${ACTIVE} [data-sentry-component="SnapshotArchiveSection"] {
      color: var(--kt-text) !important;
    }

    html.${ACTIVE} [data-sentry-component="SnapshotArchiveSection"] > button:first-child {
      color: #26343C !important;
    }

    html.${ACTIVE} [data-sentry-component="SnapshotArchiveSection"] > button:first-child svg {
      color: #7B898F !important;
    }

    /* 썸네일 카드 자체는 이미지 유지, 테두리만 밝게 */
    html.${ACTIVE} [data-sentry-component="SnapshotArchiveSection"]
      button[class*="overflow-hidden"] {
      background: #F1F3F4 !important;
      border: 1px solid #E1E6E9 !important;
    }

    html.${ACTIVE} [data-sentry-component="SnapshotArchiveSection"]
      button[aria-label="Open snapshot archive"] {
      color: #53636C !important;
    }

    html.${ACTIVE} [data-sentry-component="SnapshotArchiveSection"]
      button[aria-label="Open snapshot archive"] svg {
      background: #EEF1F3 !important;
      color: #53636C !important;
      border-radius: 999px !important;
    }

    html.${ACTIVE} [data-sentry-component="SnapshotArchiveSection"]
      button[aria-label="Open snapshot archive"] span {
      color: #687780 !important;
    }

    /* 사이드 메뉴 구분선 */
    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      [role="dialog"][aria-label="Chat menu"] div[class*="border-t-white/5"] {
      border-top-color: #E7EBEE !important;
    }

    /* 일반 메뉴 버튼 */
    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      [role="dialog"][aria-label="Chat menu"] button[data-sentry-component="LogRawButton"] {
      color: #26343C !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      [role="dialog"][aria-label="Chat menu"] button[data-sentry-component="LogRawButton"]:hover {
      background: #F6F8F9 !important;
    }

    /* 메뉴의 주 텍스트 */
    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      [role="dialog"][aria-label="Chat menu"] .text-gray-200 {
      color: #26343C !important;
    }

    /* 메뉴의 보조 텍스트 */
    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      [role="dialog"][aria-label="Chat menu"] [class*="text-white/50"] {
      color: #7A878E !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      [role="dialog"][aria-label="Chat menu"] svg[class*="text-white/50"] {
      color: #8A969C !important;
    }

    /* 새로하기 설명 */
    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      [role="dialog"][aria-label="Chat menu"] .body12[class*="text-white/50"] {
      color: #8A969C !important;
    }

    /* 현재 선택값: 프로필/상태창/선택지 */
    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      [role="dialog"][aria-label="Chat menu"] .body14[class*="text-white/50"] {
      color: #6F7D84 !important;
    }

    /* 클릭 피드백 */
    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      [role="dialog"][aria-label="Chat menu"] button:active {
      background: #EEF2F4 !important;
    }

    /* 위험 액션: 대화 삭제 */
    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      .kt-sidebar-danger {
      color: #D94B4B !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      .kt-sidebar-danger:hover {
      background: #FFF1F1 !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      .kt-sidebar-danger span,
    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      .kt-sidebar-danger svg {
      color: #D94B4B !important;
    }

    /* 하단 '대화방 나가기' 영역 */
    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      .kt-sidebar-footer {
      background: #F8F9FA !important;
      border-top: 1px solid #E4E9EC !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      .kt-sidebar-footer button {
      color: #D94B4B !important;
      background: transparent !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      .kt-sidebar-footer button:hover {
      background: #FFF1F1 !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      .kt-sidebar-footer svg,
    html.${ACTIVE} [data-sentry-component="ChatSidebar"]
      .kt-sidebar-footer span {
      color: #D94B4B !important;
    }


    /* =========================================================
       v3.13 - 스냅샷 보관함
    ========================================================= */

    html.${ACTIVE} .kt-snapshot-archive-modal {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      box-shadow: 0 0 28px rgba(38,52,61,.12) !important;
    }

    /* 모달 뒤쪽 어두운 배경 제거 */
    html.${ACTIVE} .kt-snapshot-archive-wrap > [role="presentation"] {
      background: rgba(43,57,66,.24) !important;
    }

    /* 상단 헤더 */
    html.${ACTIVE} .kt-snapshot-archive-modal
      > div:first-child > div:first-child {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      border-bottom: 1px solid #E5EAED !important;
    }

    html.${ACTIVE} .kt-snapshot-archive-modal
      button[aria-label="Close"] {
      color: #26343C !important;
      background: transparent !important;
    }

    html.${ACTIVE} .kt-snapshot-archive-modal
      button[aria-label="Close"] svg {
      color: #26343C !important;
    }

    html.${ACTIVE} .kt-snapshot-archive-modal h3 {
      color: #26343C !important;
    }

    /* 그리드 영역 */
    html.${ACTIVE} .kt-snapshot-archive-modal
      [aria-label="Snapshot archive"] {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      scrollbar-width: thin !important;
      scrollbar-color: rgba(65,84,95,.20) transparent !important;
    }

    html.${ACTIVE} .kt-snapshot-archive-modal
      [aria-label="Snapshot archive"]::-webkit-scrollbar {
      width: 5px !important;
    }

    html.${ACTIVE} .kt-snapshot-archive-modal
      [aria-label="Snapshot archive"]::-webkit-scrollbar-thumb {
      background: rgba(65,84,95,.20) !important;
      border-radius: 999px !important;
    }

    html.${ACTIVE} .kt-snapshot-archive-modal
      [aria-label="Snapshot archive"] button {
      color: var(--kt-text) !important;
      border-radius: 10px !important;
      padding: 4px !important;
      transition: background-color .15s ease !important;
    }

    html.${ACTIVE} .kt-snapshot-archive-modal
      [aria-label="Snapshot archive"] button:hover {
      background: #F5F7F8 !important;
    }

    html.${ACTIVE} .kt-snapshot-archive-modal
      [aria-label="Snapshot archive"] button > div:first-child {
      background: #EEF1F3 !important;
      border: 1px solid #E2E7EA !important;
      box-shadow: 0 1px 3px rgba(45,61,71,.06) !important;
    }

    html.${ACTIVE} .kt-snapshot-archive-modal
      [aria-label="Snapshot archive"] button .caption1 {
      color: #7A878E !important;
    }


    /* =========================================================
       v3.13 - 스냅샷 상세 보기
    ========================================================= */

    html.${ACTIVE} .kt-snapshot-viewer-modal {
      background: #EEF2F4 !important;
      color: var(--kt-text) !important;
      box-shadow: 0 0 28px rgba(38,52,61,.12) !important;
    }

    html.${ACTIVE} .kt-snapshot-viewer-wrap > [role="presentation"] {
      background: rgba(43,57,66,.28) !important;
    }

    /* 이미지가 놓이는 캔버스 */
    html.${ACTIVE} .kt-snapshot-viewer-modal
      [aria-label="Show or hide snapshot controls"] {
      background: #E8EEF1 !important;
    }

    html.${ACTIVE} .kt-snapshot-viewer-modal
      [aria-label="Show or hide snapshot controls"] img {
      filter: none !important;
    }

    /* 위/아래 컨트롤 바 */
    html.${ACTIVE} .kt-snapshot-viewer-modal
      [class*="bg-gray-main/80"] {
      background: rgba(255,255,255,.96) !important;
      color: var(--kt-text) !important;
      backdrop-filter: blur(10px) !important;
    }

    /* 상단바 */
    html.${ACTIVE} .kt-snapshot-viewer-modal
      [class*="h-header"][class*="justify-between"] {
      border-bottom: 1px solid #E2E7EA !important;
    }

    html.${ACTIVE} .kt-snapshot-viewer-modal
      button[aria-label="Close"],
    html.${ACTIVE} .kt-snapshot-viewer-modal
      button[aria-label="Save snapshot"] {
      color: #26343C !important;
      background: transparent !important;
    }

    html.${ACTIVE} .kt-snapshot-viewer-modal
      button[aria-label="Close"] svg,
    html.${ACTIVE} .kt-snapshot-viewer-modal
      button[aria-label="Save snapshot"] svg {
      color: #26343C !important;
    }

    html.${ACTIVE} .kt-snapshot-viewer-modal h3 {
      color: #26343C !important;
    }

    /* 삭제는 의미색 유지 */
    html.${ACTIVE} .kt-snapshot-viewer-modal
      button[aria-label="Delete snapshot"] {
      background: transparent !important;
      color: #D94B4B !important;
    }

    html.${ACTIVE} .kt-snapshot-viewer-modal
      button[aria-label="Delete snapshot"] svg {
      color: #D94B4B !important;
    }

    /* 하단 액션 영역 */
    html.${ACTIVE} .kt-snapshot-viewer-modal
      .kt-snapshot-viewer-footer {
      background: rgba(255,255,255,.97) !important;
      border-top: 1px solid #E2E7EA !important;
      color: var(--kt-text) !important;
    }

    html.${ACTIVE} .kt-snapshot-viewer-modal
      .kt-snapshot-viewer-actions button {
      color: #50616B !important;
      background: transparent !important;
      border-radius: 10px !important;
    }

    html.${ACTIVE} .kt-snapshot-viewer-modal
      .kt-snapshot-viewer-actions button:hover {
      background: #F3F6F7 !important;
    }

    html.${ACTIVE} .kt-snapshot-viewer-modal
      .kt-snapshot-viewer-actions button svg {
      color: #50616B !important;
    }

    html.${ACTIVE} .kt-snapshot-viewer-modal
      .kt-snapshot-viewer-actions button span {
      color: #687780 !important;
    }

    /* 신고 버튼은 살짝 붉은 의미색 */
    html.${ACTIVE} .kt-snapshot-viewer-modal
      .kt-snapshot-report {
      color: #B85B5B !important;
    }

    html.${ACTIVE} .kt-snapshot-viewer-modal
      .kt-snapshot-report svg,
    html.${ACTIVE} .kt-snapshot-viewer-modal
      .kt-snapshot-report span {
      color: #B85B5B !important;
    }

    /* 댓글 공유 = 카카오 노랑 메인 액션 */
    html.${ACTIVE} .kt-snapshot-viewer-modal
      .kt-snapshot-share {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E4CF00 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} .kt-snapshot-viewer-modal
      .kt-snapshot-share:hover {
      background: var(--kt-yellow-hover) !important;
    }

    html.${ACTIVE} .kt-snapshot-viewer-modal
      .kt-snapshot-share span,
    html.${ACTIVE} .kt-snapshot-viewer-modal
      .kt-snapshot-share svg {
      color: #191919 !important;
    }


    /* =========================================================
       v3.14 - 메시지/친구 팝업 전체
    ========================================================= */

    html.${ACTIVE} [data-testid="message-phone-backdrop"] {
      background: rgba(43,57,66,.34) !important;
    }

    html.${ACTIVE} .kt-message-panel {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      border: 1px solid #DEE5E9 !important;
      box-shadow: 0 18px 44px rgba(35,50,59,.18) !important;
      ring: none !important;
    }

    /* 팝업 상단 헤더 */
    html.${ACTIVE} .kt-message-panel > div:first-child {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      border-bottom-color: #E6EBEE !important;
    }

    html.${ACTIVE} .kt-message-panel > div:first-child p,
    html.${ACTIVE} .kt-message-panel > div:first-child span {
      color: #26343C !important;
    }

    html.${ACTIVE} .kt-message-panel > div:first-child button {
      background: transparent !important;
      color: #26343C !important;
    }

    html.${ACTIVE} .kt-message-panel > div:first-child button svg {
      color: #26343C !important;
    }

    /* 아바타 빈 배경 */
    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="Avatar"] {
      background: #E9EEF1 !important;
    }

    /* 친구 목록 / 채팅 목록 */
    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="ContactList"],
    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="ThreadList"] {
      background: #FFFFFF !important;
    }

    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="ContactList"] > li > button,
    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="ThreadList"] > li > button {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      border-radius: 10px !important;
      margin-left: 6px !important;
      margin-right: 6px !important;
      width: calc(100% - 12px) !important;
    }

    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="ContactList"] > li > button:hover,
    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="ThreadList"] > li > button:hover {
      background: #F5F7F8 !important;
    }

    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="ContactList"] .body2,
    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="ThreadList"] .body2 {
      color: #26343C !important;
    }

    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="ThreadList"] .caption1 {
      color: #7D898F !important;
    }

    /* 친구 / 채팅 하단 탭 */
    html.${ACTIVE} .kt-message-tabs {
      background: #FFFFFF !important;
      border-top: 1px solid #E5EAED !important;
    }

    html.${ACTIVE} .kt-message-tabs > button {
      background: transparent !important;
      color: #9AA4A9 !important;
      border-radius: 0 !important;
    }

    html.${ACTIVE} .kt-message-tabs > button svg,
    html.${ACTIVE} .kt-message-tabs > button span {
      color: inherit !important;
    }

    html.${ACTIVE} .kt-message-tabs > button[aria-pressed="true"] {
      color: #26343C !important;
      box-shadow: inset 0 3px 0 var(--kt-yellow) !important;
      background: #FFFDF0 !important;
    }

    html.${ACTIVE} .kt-message-tabs > button[aria-pressed="false"]:hover {
      background: #F7F8F9 !important;
    }

    /* 메시지 팝업 안 모델 버튼 */
    html.${ACTIVE} [data-testid="message-phone-model"] {
      background: #667B88 !important;
      color: #FFFFFF !important;
      border: 1px solid #5D727F !important;
      box-shadow: 0 1px 3px rgba(40,55,64,.12) !important;
    }

    html.${ACTIVE} [data-testid="message-phone-model"] svg {
      color: rgba(255,255,255,.90) !important;
    }


    /* =========================================================
       v3.14 - 메시지 1:1 채팅
    ========================================================= */

    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="ThreadView"] {
      background: var(--kt-chat) !important;
      color: var(--kt-text) !important;
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }

    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="ThreadView"]::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
    }

    /* 상대 메시지 */
    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="Bubble"][data-sender="CHARACTER"] p {
      background: #FFFFFF !important;
      color: #202124 !important;
      box-shadow: 0 1px 2px rgba(0,0,0,.05) !important;
    }

    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="Bubble"][data-sender="CHARACTER"]
      [data-sentry-component="BubbleTail"] {
      fill: #FFFFFF !important;
      color: #FFFFFF !important;
    }

    /* 내 메시지 */
    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="Bubble"][data-sender="USER"] p {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      box-shadow: 0 1px 2px rgba(0,0,0,.05) !important;
    }

    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="Bubble"][data-sender="USER"]
      [data-sentry-component="BubbleTail"] {
      fill: var(--kt-yellow) !important;
      color: var(--kt-yellow) !important;
    }

    /* 메시지 입력창 */
    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="Composer"] {
      background: #FFFFFF !important;
      border-top: 1px solid #E4E9EC !important;
    }

    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="Composer"] > div > div {
      background: #F5F6F7 !important;
      border: 1px solid #DEE4E8 !important;
    }

    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="Composer"] input[aria-label="메시지 입력"] {
      background: transparent !important;
      color: #191919 !important;
      caret-color: #191919 !important;
    }

    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="Composer"] input[aria-label="메시지 입력"]::placeholder {
      color: #999FA3 !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="Composer"] button[aria-label="보내기"] {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E6D000 !important;
    }

    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="Composer"] button[aria-label="보내기"] svg {
      color: #191919 !important;
    }

    html.${ACTIVE} .kt-message-panel
      [data-sentry-component="Composer"] button[aria-label="보내기"]:disabled {
      background: #E7EAEC !important;
      color: #A7AFB3 !important;
      border-color: #E0E4E6 !important;
    }

    /* =========================================================
       v3.14 - 추천 답변 패널
    ========================================================= */

    html.${ACTIVE} [data-sentry-component="QuickReplyPanel"] {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      border-top: 1px solid #DEE5E9 !important;
      box-shadow: 0 -8px 22px rgba(42,57,66,.10) !important;
    }

    /* 추천 답변 카드 */
    html.${ACTIVE} [data-sentry-component="QuickReplySetSlide"] > button {
      background: #F4F6F7 !important;
      color: #191919 !important;
      border: 1px solid #E4E9EC !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} [data-sentry-component="QuickReplySetSlide"] > button:hover {
      background: #FFF9C8 !important;
      border-color: #E8D85B !important;
    }

    html.${ACTIVE} [data-sentry-component="QuickReplySetSlide"] > button .body14,
    html.${ACTIVE} [data-sentry-component="QuickReplySetSlide"] > button p {
      color: #202124 !important;
    }

    html.${ACTIVE} [data-sentry-component="QuickReplySetSlide"] > button em {
      color: #68777F !important;
    }

    /* 로딩 카드 */
    html.${ACTIVE} [data-sentry-component="QuickReplySetSlide"]
      [aria-label="Loading suggestions"] {
      background: #F4F6F7 !important;
      border: 1px solid #E4E9EC !important;
    }

    html.${ACTIVE} [data-sentry-component="QuickReplySetSlide"]
      [aria-label="Loading suggestions"] svg {
      color: #7B898F !important;
    }

    /* 하단 사용량/재생성 바 */
    html.${ACTIVE} [data-sentry-component="QuickReplyRegenControlBar"] {
      background: #FFFFFF !important;
      border-top-color: #E3E8EB !important;
    }

    html.${ACTIVE} [data-sentry-component="QuickReplyQuota"] {
      color: #7B878D !important;
    }

    html.${ACTIVE} [data-sentry-component="QuickReplyQuota"] > span {
      color: #7B878D !important;
    }

    html.${ACTIVE} [data-sentry-component="QuickReplyQuota"]
      [data-sentry-component="renderWhite"] {
      color: #26343C !important;
    }

    html.${ACTIVE} button[aria-label="Free usage info"] {
      color: #7B878D !important;
    }

    html.${ACTIVE} button[aria-label="Free usage info"] svg {
      color: #7B878D !important;
    }

    /* 다른 추천 보기 */
    html.${ACTIVE} button[aria-label="See other suggestions"] {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E6D000 !important;
    }

    html.${ACTIVE} button[aria-label="See other suggestions"]:hover {
      background: var(--kt-yellow-hover) !important;
    }

    html.${ACTIVE} button[aria-label="See other suggestions"] svg {
      color: #191919 !important;
    }


    /* =========================================================
       v3.15 - 메인 + 버튼
    ========================================================= */

    html.${ACTIVE} [data-testid="action-panel-button"] {
      background: rgba(255,255,255,.92) !important;
      color: #40515A !important;
      border: 1px solid rgba(64,81,90,.16) !important;
      box-shadow: 0 1px 4px rgba(39,55,64,.10) !important;
    }

    html.${ACTIVE} [data-testid="action-panel-button"]:hover {
      background: #FFFFFF !important;
      border-color: rgba(64,81,90,.22) !important;
    }

    html.${ACTIVE} [data-testid="action-panel-button"] svg {
      color: #40515A !important;
    }


    /* =========================================================
       v3.15 - 내레이터 글씨 한 톤 진하게
    ========================================================= */

    html.${ACTIVE} [data-sentry-component="NarratorBubble"] > div {
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} [data-sentry-component="NarratorBubble"] .chat,
    html.${ACTIVE} [data-sentry-component="NarratorBubble"] p,
    html.${ACTIVE} [data-sentry-component="NarratorBubble"] em,
    html.${ACTIVE} [data-sentry-component="NarratorBubble"] li {
      color: #4E5C64 !important;
    }

    html.${ACTIVE} [data-sentry-component="NarratorBubble"] strong {
      color: #36464F !important;
    }

    html.${ACTIVE} [data-sentry-component="NarratorBubble"] svg {
      color: #52616A !important;
    }


    /* =========================================================
       v3.15 - 상태창(InfoBox) 배경 제거 + 글씨 진하게
    ========================================================= */

    html.${ACTIVE} [data-sentry-component="InfoBoxContent"][class*="mx-2"] {
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
      color: #4B5961 !important;
    }

    html.${ACTIVE} [data-sentry-component="InfoBoxContent"][class*="mx-2"] .chat,
    html.${ACTIVE} [data-sentry-component="InfoBoxContent"][class*="mx-2"] [class*="text-white/"],
    html.${ACTIVE} [data-sentry-component="InfoBoxContent"][class*="mx-2"] .caption1 {
      color: #4B5961 !important;
    }

    html.${ACTIVE} [data-sentry-component="InfoBoxContent"][class*="mx-2"] .font-bold,
    html.${ACTIVE} [data-sentry-component="InfoBoxContent"][class*="mx-2"] .font-semibold {
      color: #34434C !important;
    }

    html.${ACTIVE} [data-sentry-component="InfoBoxContent"][class*="mx-2"]
      [data-sentry-component="InfoBoxCollapseToggle"] svg {
      color: #52616A !important;
    }


    /* =========================================================
       v3.16 - 이어하기 / 삭제 모드 / 확인 팝업 전체 정리
    ========================================================= */

    html.${ACTIVE}.kt-continue-open,
    html.${ACTIVE}.kt-continue-open body,
    html.${ACTIVE}.kt-continue-open main#contents {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
    }

    html.${ACTIVE}.kt-continue-open [role="log"][aria-label="Chat messages"] {
      background: transparent !important;
    }

    html.${ACTIVE}.kt-continue-open .kt-continue-screen,
    html.${ACTIVE}.kt-continue-open .kt-continue-empty,
    html.${ACTIVE} .kt-continue-panel,
    html.${ACTIVE} .kt-continue-empty-wrap {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
    }

    html.${ACTIVE}.kt-continue-open .kt-continue-screen *,
    html.${ACTIVE} .kt-continue-panel * {
      color: inherit !important;
    }

    html.${ACTIVE} .kt-continue-panel,
    html.${ACTIVE} .kt-continue-panel [class*="bg-gray-main"],
    html.${ACTIVE} .kt-continue-panel [class*="bg-black"],
    html.${ACTIVE} .kt-continue-panel [class*="bg-zinc"],
    html.${ACTIVE} .kt-continue-panel [class*="bg-neutral"] {
      background: #FFFFFF !important;
    }

    html.${ACTIVE} .kt-continue-panel [class*="text-white"],
    html.${ACTIVE} .kt-continue-panel .caption1,
    html.${ACTIVE}.kt-continue-open .kt-continue-screen .caption1,
    html.${ACTIVE}.kt-continue-open .kt-continue-screen [class*="text-white/"] {
      color: #6F7C83 !important;
    }

    html.${ACTIVE} .kt-continue-panel [class*="font-bold"],
    html.${ACTIVE} .kt-continue-panel h1,
    html.${ACTIVE} .kt-continue-panel h2,
    html.${ACTIVE} .kt-continue-panel h3,
    html.${ACTIVE} .kt-continue-panel strong {
      color: #28363E !important;
    }

    html.${ACTIVE} .kt-continue-panel button,
    html.${ACTIVE} .kt-continue-panel svg {
      color: #4E5D66 !important;
    }

    html.${ACTIVE}.kt-continue-open .kt-continue-screen [class*="border-b-white/"],
    html.${ACTIVE}.kt-continue-open .kt-continue-screen [class*="border-white/"],
    html.${ACTIVE} .kt-continue-panel [class*="border-b-white/"],
    html.${ACTIVE} .kt-continue-panel [class*="border-white/"],
    html.${ACTIVE} .kt-continue-panel [class*="border-gray"] {
      border-color: #E6EBEE !important;
    }

    html.${ACTIVE} [data-sentry-component="DeleteModeHeader"] {
      background: rgba(255,255,255,.96) !important;
      border-bottom: 1px solid #E5EAED !important;
      backdrop-filter: blur(10px) !important;
      box-shadow: 0 1px 0 rgba(0,0,0,.02) !important;
    }

    html.${ACTIVE} [data-sentry-component="DeleteModeHeader"] header,
    html.${ACTIVE} [data-sentry-component="DeleteModeHeader"] nav {
      background: transparent !important;
      border-color: transparent !important;
    }

    html.${ACTIVE} [data-sentry-component="DeleteModeHeader"] h1,
    html.${ACTIVE} [data-sentry-component="DeleteModeHeader"] h2,
    html.${ACTIVE} [data-sentry-component="DeleteModeHeader"] h3,
    html.${ACTIVE} [data-sentry-component="DeleteModeHeader"] span,
    html.${ACTIVE} [data-sentry-component="DeleteModeHeader"] button {
      color: var(--kt-text) !important;
    }

    html.${ACTIVE} [data-sentry-component="DeleteModeHeader"] button svg {
      color: var(--kt-text) !important;
    }

    html.${ACTIVE} [data-testid="delete-mode-header-clear"] {
      color: #7B6740 !important;
    }

    html.${ACTIVE} [data-sentry-component="DeleteStartNotice"] {
      background: rgba(255,255,255,.82) !important;
      color: #485860 !important;
      border-bottom: 1px solid rgba(61,79,89,.08) !important;
      backdrop-filter: blur(8px) !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatMessageDeleteSelector"]:hover {
      background: rgba(254,229,0,.16) !important;
    }

    /* 삭제 시작점 선택 UI의 보라색 선택선 제거 */
    html.${ACTIVE}.kt-delete-mode-screen [data-sentry-component="ChatMessageDeleteSelector"],
    html.${ACTIVE} .kt-delete-mode-screen [data-sentry-component="ChatMessageDeleteSelector"] {
      border-color: rgba(84,103,114,.18) !important;
      outline: none !important;
      box-shadow: none !important;
    }

    html.${ACTIVE}.kt-delete-mode-screen [data-sentry-component="ChatMessageDeleteSelector"] [class*="border-primary-"],
    html.${ACTIVE} .kt-delete-mode-screen [data-sentry-component="ChatMessageDeleteSelector"] [class*="border-primary-"],
    html.${ACTIVE}.kt-delete-mode-screen [data-sentry-component="ChatMessageDeleteSelector"][class*="border-primary-"],
    html.${ACTIVE} .kt-delete-mode-screen [data-sentry-component="ChatMessageDeleteSelector"][class*="border-primary-"] {
      border-color: #D8E1E6 !important;
    }

    html.${ACTIVE}.kt-delete-mode-screen [data-sentry-component="ChatMessageDeleteSelector"] [class*="ring-primary-"],
    html.${ACTIVE} .kt-delete-mode-screen [data-sentry-component="ChatMessageDeleteSelector"] [class*="ring-primary-"],
    html.${ACTIVE}.kt-delete-mode-screen [data-sentry-component="ChatMessageDeleteSelector"] [class*="outline-primary-"],
    html.${ACTIVE} .kt-delete-mode-screen [data-sentry-component="ChatMessageDeleteSelector"] [class*="outline-primary-"] {
      --tw-ring-color: rgba(216,225,230,.95) !important;
      outline-color: #D8E1E6 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE}.kt-delete-mode-screen [data-sentry-component="ChatMessageDeleteSelector"] [class*="text-primary-"],
    html.${ACTIVE} .kt-delete-mode-screen [data-sentry-component="ChatMessageDeleteSelector"] [class*="text-primary-"] {
      color: #62717A !important;
    }

    html.${ACTIVE}.kt-delete-mode-screen [data-sentry-component="ChatMessageDeleteSelector"] [class*="bg-primary-"],
    html.${ACTIVE} .kt-delete-mode-screen [data-sentry-component="ChatMessageDeleteSelector"] [class*="bg-primary-"] {
      background: rgba(254,229,0,.16) !important;
    }

    html.${ACTIVE} .kt-delete-mode-button-row {
      background: rgba(255,255,255,.94) !important;
      border-top: 1px solid #E5EAED !important;
      box-shadow: 0 -8px 22px rgba(42,57,66,.10) !important;
      backdrop-filter: blur(10px) !important;
      padding-top: 10px !important;
      padding-bottom: calc(10px + var(--safe-area-inset-bottom,0px)) !important;
    }

    html.${ACTIVE} .kt-delete-mode-button {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E2CB00 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} .kt-delete-mode-button:hover {
      background: var(--kt-yellow-hover) !important;
    }

    html.${ACTIVE} .kt-delete-mode-button:disabled {
      background: #E7EAEC !important;
      color: #A7AFB3 !important;
      border-color: #E0E4E6 !important;
    }

    html.${ACTIVE} .kt-theme-dialog-layer {
      background: rgba(43,57,66,.34) !important;
      backdrop-filter: blur(8px) !important;
    }

    html.${ACTIVE} .kt-theme-dialog {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      border: 1px solid #DEE5E9 !important;
      border-radius: 20px !important;
      box-shadow: 0 18px 44px rgba(35,50,59,.22) !important;
    }

    html.${ACTIVE} .kt-theme-dialog *,
    html.${ACTIVE} .kt-theme-dialog svg {
      color: inherit !important;
    }

    html.${ACTIVE} .kt-theme-dialog p,
    html.${ACTIVE} .kt-theme-dialog span,
    html.${ACTIVE} .kt-theme-dialog h1,
    html.${ACTIVE} .kt-theme-dialog h2,
    html.${ACTIVE} .kt-theme-dialog h3,
    html.${ACTIVE} .kt-theme-dialog h4 {
      color: #28363E !important;
    }

    html.${ACTIVE} .kt-theme-dialog [class*="text-white/"],
    html.${ACTIVE} .kt-theme-dialog .caption1,
    html.${ACTIVE} .kt-theme-dialog .body14,
    html.${ACTIVE} .kt-theme-dialog .body16 {
      color: #67757D !important;
    }

    html.${ACTIVE} .kt-dialog-checkrow {
      color: #46545E !important;
    }

    html.${ACTIVE} .kt-dialog-checkrow svg {
      color: #46545E !important;
    }

    html.${ACTIVE} .kt-dialog-confirm {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E2CB00 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} .kt-dialog-confirm:hover {
      background: var(--kt-yellow-hover) !important;
    }

    html.${ACTIVE} .kt-dialog-cancel {
      background: #ECEFF1 !important;
      color: #46545E !important;
      border: 1px solid #E0E5E8 !important;
      box-shadow: none !important;
    }


    html.${ACTIVE} .kt-delete-mode-screen [class*="bg-black"],
    html.${ACTIVE} .kt-delete-mode-screen [class*="bg-gray-main"] {
      background: #FFFFFF !important;
    }

    html.${ACTIVE} .kt-delete-mode-screen [class*="text-white"],
    html.${ACTIVE} .kt-delete-mode-screen [class*="text-gray-200"],
    html.${ACTIVE} .kt-delete-mode-screen [class*="text-gray-300"],
    html.${ACTIVE} .kt-delete-mode-screen [class*="text-gray-400"] {
      color: #6A7880 !important;
    }

    html.${ACTIVE} .kt-delete-notice,
    html.${ACTIVE} [data-sentry-component="DeleteStartNotice"] {
      background: rgba(255,255,255,.88) !important;
      color: #55636C !important;
      border-bottom: 1px solid #E4EAEE !important;
      backdrop-filter: blur(8px) !important;
    }

    html.${ACTIVE} .kt-delete-notice *,
    html.${ACTIVE} [data-sentry-component="DeleteStartNotice"] * {
      color: inherit !important;
    }

    html.${ACTIVE} .kt-theme-dialog input[type="checkbox"] {
      accent-color: #FEE500 !important;
    }

    html.${ACTIVE} .kt-theme-dialog input[type="text"],
    html.${ACTIVE} .kt-theme-dialog textarea {
      background: #F7F9FA !important;
      color: #27343D !important;
      border: 1px solid #E0E6EA !important;
    }

    html.${ACTIVE} .kt-theme-dialog [class*="bg-black"],
    html.${ACTIVE} .kt-theme-dialog [class*="bg-gray-main"] {
      background: transparent !important;
    }

    html.${ACTIVE} .kt-dialog-danger {
      background: #FDECEC !important;
      color: #C84343 !important;
      border: 1px solid #F6C9C9 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} .kt-dialog-danger:hover {
      background: #F9E2E2 !important;
    }


    /* =========================================================
       v3.17 - 팝업 레이아웃 안정화
       원래 343px 박스 구조/여백을 보존하고 색만 변경
    ========================================================= */

    html.${ACTIVE} .kt-theme-dialog {
      width: min(343px, calc(100vw - 32px)) !important;
      max-width: 343px !important;
      box-sizing: border-box !important;
      overflow: hidden !important;
      padding: 32px 14px 16px !important;
      background: #FFFFFF !important;
      border: 1px solid #DEE5E9 !important;
      border-radius: 16px !important;
      color: #28363E !important;
    }

    html.${ACTIVE} .kt-theme-dialog > h1,
    html.${ACTIVE} .kt-theme-dialog > h2,
    html.${ACTIVE} .kt-theme-dialog > h3,
    html.${ACTIVE} .kt-theme-dialog > h4,
    html.${ACTIVE} .kt-theme-dialog > h5,
    html.${ACTIVE} .kt-theme-dialog > p,
    html.${ACTIVE} .kt-theme-dialog > span {
      max-width: 100% !important;
      box-sizing: border-box !important;
    }

    html.${ACTIVE} .kt-theme-dialog > p {
      color: #66757D !important;
    }

    /* 원래 버튼 행의 w-full/flex 구조 유지 */
    html.${ACTIVE} .kt-theme-dialog > div:has(> button) {
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      gap: 8px !important;
    }

    html.${ACTIVE} .kt-theme-dialog > div:has(> button) > button {
      min-width: 0 !important;
      max-width: 100% !important;
      flex: 1 1 0 !important;
      box-sizing: border-box !important;
      height: 40px !important;
      padding-left: 12px !important;
      padding-right: 12px !important;
      border-radius: 8px !important;
      white-space: nowrap !important;
    }

    /* 체크행도 폭 밖으로 나가지 않게 */
    html.${ACTIVE} .kt-theme-dialog .kt-dialog-checkrow {
      max-width: 100% !important;
      box-sizing: border-box !important;
      color: #46545E !important;
    }

    html.${ACTIVE} .kt-theme-dialog .kt-dialog-checkrow span {
      color: #46545E !important;
    }

    /* 보라색 체크박스도 카카오 노랑으로 */
    html.${ACTIVE} .kt-theme-dialog .kt-dialog-checkrow svg path:first-child {
      fill: var(--kt-yellow) !important;
      stroke: #D8C400 !important;
    }

    html.${ACTIVE} .kt-theme-dialog .kt-dialog-checkrow svg path:last-child {
      stroke: #3A3515 !important;
    }



    /* =========================================================
       v3.18 - 대화 프로필 바텀시트
    ========================================================= */

    html.${ACTIVE} .kt-profile-hub-backdrop {
      background: rgba(43,57,66,.28) !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      border-top: 1px solid #E2E8EB !important;
      box-shadow: 0 -10px 28px rgba(42,57,66,.14) !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet > div:first-child {
      background: #FFFFFF !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet > div:first-child svg {
      color: #C2CBD0 !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet
      [role="dialog"][aria-label="대화 프로필"] {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet
      [role="dialog"][aria-label="대화 프로필"] > div {
      background: #FFFFFF !important;
    }

    /* 섹션 제목 */
    html.${ACTIVE} .kt-profile-hub-sheet
      [role="dialog"][aria-label="대화 프로필"] h3 {
      color: #67757D !important;
      font-weight: 600 !important;
    }

    /* 추천 프로필 / 내 프로필 카드 */
    html.${ACTIVE} .kt-profile-hub-sheet
      [data-sentry-component="ChatProfileListItem"] {
      background: #F5F7F8 !important;
      color: #26343C !important;
      border-color: #E5EAED !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet
      [data-sentry-component="ChatProfileListItem"]:hover {
      background: #F0F3F5 !important;
    }

    /* 프로필명 */
    html.${ACTIVE} .kt-profile-hub-sheet
      [data-sentry-component="ChatProfileListItem"] .body1,
    html.${ACTIVE} .kt-profile-hub-sheet
      [data-sentry-component="ChatProfileListItem"] [class*="text-gray-200"] {
      color: #26343C !important;
    }

    /* 설명 */
    html.${ACTIVE} .kt-profile-hub-sheet
      [data-sentry-component="ChatProfileListItem"] .caption1,
    html.${ACTIVE} .kt-profile-hub-sheet
      [data-sentry-component="ChatProfileListItem"] [class*="text-white/50"] {
      color: #748188 !important;
    }

    /* 편집 아이콘 */
    html.${ACTIVE} .kt-profile-hub-sheet
      button[aria-label^="edit-"] {
      background: transparent !important;
      color: #75838A !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet
      button[aria-label^="edit-"] svg {
      color: #75838A !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet
      button[aria-label^="edit-"]:hover {
      background: rgba(86,103,113,.07) !important;
      border-radius: 999px !important;
    }

    /* 선택 체크 = 카카오 노랑 */
    html.${ACTIVE} .kt-profile-hub-sheet
      [data-sentry-component="ChatProfileListItem"] .kt-profile-hub-selected {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      box-shadow: 0 0 0 1px rgba(170,148,0,.12) !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet
      [data-sentry-component="ChatProfileListItem"] .kt-profile-hub-selected svg {
      color: #191919 !important;
    }

    /* 대화 프로필 추가 */
    html.${ACTIVE} .kt-profile-hub-sheet .kt-profile-add-button {
      background: #F5F7F8 !important;
      color: #26343C !important;
      border: 1px solid #E5EAED !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet .kt-profile-add-button:hover {
      background: #F0F3F5 !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet .kt-profile-add-button > div:first-child {
      background: #E8EDF0 !important;
      color: #50616B !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet .kt-profile-add-button svg,
    html.${ACTIVE} .kt-profile-hub-sheet .kt-profile-add-button span {
      color: #50616B !important;
    }

    /* 내 프로필 목록 */
    html.${ACTIVE} .kt-profile-hub-sheet
      [role="group"][aria-label="My chat profiles"] {
      background: #FFFFFF !important;
      border: 1px solid #E6EBEE !important;
      border-radius: 12px !important;
      overflow: hidden !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet
      [role="group"][aria-label="My chat profiles"]
      [data-sentry-component="ChatProfileListItem"] {
      background: #FFFFFF !important;
      border-radius: 0 !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet
      [role="group"][aria-label="My chat profiles"]
      [data-sentry-component="ChatProfileListItem"]:hover {
      background: #F7F9FA !important;
    }

    /* 원래 다크용 구분선 */
    html.${ACTIVE} .kt-profile-hub-sheet
      [role="group"][aria-label="My chat profiles"] > div[class*="bg-white/5"] {
      background: #FFFFFF !important;
    }

    html.${ACTIVE} .kt-profile-hub-sheet
      [role="group"][aria-label="My chat profiles"] > div[class*="bg-white/5"] > div {
      background: #E9EDF0 !important;
    }

    /* 바텀시트 스크롤 */
    html.${ACTIVE} .kt-profile-hub-sheet
      [role="dialog"][aria-label="대화 프로필"]
      :is(div,section) {
      scrollbar-color: rgba(70,88,99,.18) transparent !important;
    }


    /* =========================================================
       v3.19 - 대화 프로필 편집 페이지
       /my-plot-chat-profile/.../.../edit
    ========================================================= */

    html.kt-profile-edit-active {
      background: var(--kt-chat) !important;
      color-scheme: light !important;
    }

    html.kt-profile-edit-active body {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
    }

    html.kt-profile-edit-active header {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      border-bottom-color: #E7EAEC !important;
    }

    html.kt-profile-edit-active header h3 {
      color: #202124 !important;
    }

    html.kt-profile-edit-active header button {
      color: #26343C !important;
      background: transparent !important;
    }

    html.kt-profile-edit-active header button svg {
      color: #26343C !important;
    }

    html.kt-profile-edit-active main#contents,
    html.kt-profile-edit-active
      [data-sentry-component="MyPlotChatProfileEditPage"],
    html.kt-profile-edit-active
      [data-sentry-component="MyPlotChatProfileEdit"] {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
    }

    /* 프로필 미리보기 */
    html.kt-profile-edit-active
      [data-sentry-component="MyPlotChatProfileEdit"]
      [data-sentry-source-file="ChatProfilePreview.tsx"] {
      color: var(--kt-text) !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="MyPlotChatProfileEdit"]
      .title18 {
      color: #202124 !important;
    }

    html.kt-profile-edit-active .kt-profile-edit-badge {
      background: var(--kt-yellow) !important;
      color: #303030 !important;
      border: 2px solid #FFFFFF !important;
      box-shadow: 0 1px 3px rgba(0,0,0,.12) !important;
    }

    html.kt-profile-edit-active .kt-profile-edit-badge svg {
      color: #303030 !important;
    }

    /* 섹션 제목 / 설명 */
    html.kt-profile-edit-active
      [data-sentry-component="EditFormSectionContainer"]
      .heading3,
    html.kt-profile-edit-active
      [data-sentry-component="EditFormSectionContainer"]
      .body16 {
      color: #2B3439 !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="EditFormSectionContainer"]
      .body12 {
      color: #858F94 !important;
    }

    /* 이름 입력칸 */
    html.kt-profile-edit-active
      label[data-sentry-component="Input"] {
      background: #F5F6F7 !important;
      color: #202124 !important;
      border-color: #DFE4E7 !important;
      box-shadow: none !important;
    }

    html.kt-profile-edit-active
      label[data-sentry-component="Input"]:focus-within {
      background: #FFFFFF !important;
      border-color: #C7CED2 !important;
      box-shadow: 0 0 0 3px rgba(254,229,0,.20) !important;
    }

    html.kt-profile-edit-active
      input[data-sentry-component="Input"] {
      background: transparent !important;
      color: #202124 !important;
      caret-color: #4A4A4A !important;
    }

    html.kt-profile-edit-active
      input[data-sentry-component="Input"]::placeholder {
      color: #9AA2A6 !important;
      opacity: 1 !important;
    }

    /* 설명 입력칸 */
    html.kt-profile-edit-active
      textarea[data-sentry-component="Textarea"] {
      background: #F5F6F7 !important;
      color: #202124 !important;
      caret-color: #4A4A4A !important;
      border-color: #DFE4E7 !important;
      box-shadow: none !important;
      scrollbar-width: thin !important;
      scrollbar-color: rgba(75,90,100,.22) transparent !important;
    }

    html.kt-profile-edit-active
      textarea[data-sentry-component="Textarea"]:focus {
      background: #FFFFFF !important;
      border-color: #C7CED2 !important;
      box-shadow: 0 0 0 3px rgba(254,229,0,.20) !important;
    }

    html.kt-profile-edit-active
      textarea[data-sentry-component="Textarea"]::placeholder {
      color: #9AA2A6 !important;
      opacity: 1 !important;
    }

    html.kt-profile-edit-active
      textarea[data-sentry-component="Textarea"]::-webkit-scrollbar {
      width: 5px !important;
    }

    html.kt-profile-edit-active
      textarea[data-sentry-component="Textarea"]::-webkit-scrollbar-thumb {
      background: rgba(75,90,100,.22) !important;
      border-radius: 999px !important;
    }

    /* 글자 수 - 보라색 제거 */
    html.kt-profile-edit-active
      [data-sentry-component="TextareaField"] .text-primary-300,
    html.kt-profile-edit-active
      [data-sentry-component="TextareaField"] .caption12 {
      color: #6F7D84 !important;
    }

    /* 하단 선택 버튼 */
    html.kt-profile-edit-active .kt-profile-edit-footer {
      background: rgba(255,255,255,.97) !important;
    }

    html.kt-profile-edit-active .kt-profile-edit-submit {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E4CF00 !important;
      box-shadow: none !important;
    }

    html.kt-profile-edit-active .kt-profile-edit-submit:hover {
      background: var(--kt-yellow-hover) !important;
    }

    html.kt-profile-edit-active .kt-profile-edit-submit:active {
      background: #EED800 !important;
    }

    html.kt-profile-edit-active .kt-profile-edit-submit:disabled {
      background: #E8EAEB !important;
      border-color: #E0E3E5 !important;
      color: #A0A7AB !important;
    }


    /* =========================================================
       v3.20 - 상태창 보기 팝업
       JS 마커 없이 실제 dialog 구조를 직접 타겟팅
    ========================================================= */

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="상태창 보기"]
      ) > [role="presentation"] {
      background: rgba(43,57,66,.30) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="상태창 보기"]
      ) > div[class*="bg-gray-sub1"] {
      background: #FFFFFF !important;
      color: #26343C !important;
      border-top: 1px solid #E1E7EA !important;
      box-shadow: 0 -10px 26px rgba(38,52,61,.14) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="상태창 보기"]
      ) > div[class*="bg-gray-sub1"] > div:first-child svg {
      color: #C1CBD0 !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="상태창 보기"] {
      background: #FFFFFF !important;
      color: #26343C !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="상태창 보기"] > div:first-child {
      background: #F5F7F8 !important;
      border: 1px solid #E5EAED !important;
      color: #26343C !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="상태창 보기"] > div:first-child > div {
      background: transparent !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="상태창 보기"] .text-gray-200,
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="상태창 보기"] .body2 {
      color: #26343C !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="상태창 보기"] > span.caption1 {
      color: #718087 !important;
    }

    /* 토글 ON */
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="상태창 보기"]
      button[aria-label="상태창 보기"] > div[class*="bg-primary-"] {
      background: var(--kt-yellow) !important;
      box-shadow: inset 0 0 0 1px rgba(168,149,0,.15) !important;
    }

    /* 토글 OFF */
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="상태창 보기"]
      button[aria-label="상태창 보기"] > div:not([class*="bg-primary-"]) {
      background: #CDD4D8 !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="상태창 보기"]
      button[aria-label="상태창 보기"] > div > div {
      background: #FFFFFF !important;
      box-shadow: 0 1px 3px rgba(45,55,61,.20) !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="상태창 보기"] > button:last-child {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E4CF00 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="상태창 보기"] > button:last-child:hover {
      background: var(--kt-yellow-hover) !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="상태창 보기"] > button:last-child span {
      color: #191919 !important;
    }


    /* =========================================================
       v3.20 - 대화 프로필 선택창
       기존 kt-profile-hub-sheet 마커가 안 붙어도 작동하도록
       실제 dialog/KeyboardAvoidingView 구조를 직접 타겟팅
    ========================================================= */

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="대화 프로필"]
      ) > [role="presentation"] {
      background: rgba(43,57,66,.28) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="대화 프로필"]
      ) > div[class*="bg-gray-sub1"] {
      background: #FFFFFF !important;
      color: #26343C !important;
      border-top: 1px solid #E1E7EA !important;
      box-shadow: 0 -10px 28px rgba(38,52,61,.14) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="대화 프로필"]
      ) > div[class*="bg-gray-sub1"] > div:first-child svg {
      color: #C1CBD0 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="대화 프로필"]
      ) > div[class*="bg-gray-sub1"] > div:nth-child(2) {
      background: #FFFFFF !important;
      scrollbar-color: rgba(70,88,99,.18) transparent !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"],
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"] > div {
      background: #FFFFFF !important;
      color: #26343C !important;
    }

    /* 섹션 제목 */
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"] h3 {
      color: #65747C !important;
      font-weight: 600 !important;
    }

    /* 추천 카드 */
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      [data-sentry-component="ProfileHubHeader"]
      [data-sentry-component="ChatProfileListItem"] {
      background: #F4F6F7 !important;
      color: #26343C !important;
      border: 1px solid #E4E9EC !important;
    }

    /* 내 프로필 카드 */
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      [role="group"][aria-label="My chat profiles"] {
      background: #FFFFFF !important;
      border: 1px solid #E4E9EC !important;
      border-radius: 12px !important;
      overflow: hidden !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      [role="group"][aria-label="My chat profiles"]
      [data-sentry-component="ChatProfileListItem"] {
      background: #FFFFFF !important;
      color: #26343C !important;
      border-radius: 0 !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      [role="group"][aria-label="My chat profiles"]
      [data-sentry-component="ChatProfileListItem"]:hover {
      background: #F7F9FA !important;
    }

    /* 카드 텍스트 */
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      [data-sentry-component="ChatProfileListItem"] .body1,
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      [data-sentry-component="ChatProfileListItem"] [class*="text-gray-200"] {
      color: #26343C !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      [data-sentry-component="ChatProfileListItem"] .caption1,
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      [data-sentry-component="ChatProfileListItem"] [class*="text-white/50"] {
      color: #748188 !important;
    }

    /* 추천 카드 선택 체크: 보라 -> 카카오 노랑 */
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      [data-sentry-component="ChatProfileListItem"]
      div[class*="bg-primary-400"] {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      box-shadow: 0 0 0 1px rgba(168,149,0,.14) !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      [data-sentry-component="ChatProfileListItem"]
      div[class*="bg-primary-400"] svg {
      color: #191919 !important;
    }

    /* 편집 펜 */
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      button[aria-label^="edit-"] {
      background: transparent !important;
      color: #6F7E86 !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      button[aria-label^="edit-"] svg {
      color: #6F7E86 !important;
    }

    /* 대화 프로필 추가 버튼 - 두 번째 섹션의 첫 버튼 */
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      > div:nth-child(2) > button[data-sentry-component="LogRawButton"] {
      background: #F4F6F7 !important;
      color: #26343C !important;
      border: 1px solid #E4E9EC !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      > div:nth-child(2) > button[data-sentry-component="LogRawButton"] > div:first-child {
      background: #E8EDF0 !important;
      color: #50616B !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      > div:nth-child(2) > button[data-sentry-component="LogRawButton"] span,
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      > div:nth-child(2) > button[data-sentry-component="LogRawButton"] svg {
      color: #50616B !important;
    }

    /* 다크용 구분선 제거 */
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      [role="group"][aria-label="My chat profiles"] > div[class*="bg-white/5"] {
      background: #FFFFFF !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      [role="group"][aria-label="My chat profiles"] > div[class*="bg-white/5"] > div {
      background: #E8EDF0 !important;
    }


    /* =========================================================
       v3.21 - 선택지 설정 바텀시트
    ========================================================= */

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="선택지로 플레이하기"]
      ) > [role="presentation"] {
      background: rgba(43,57,66,.28) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="선택지로 플레이하기"]
      ) > div[class*="bg-gray-sub1"] {
      background: #FFFFFF !important;
      color: #26343C !important;
      border-top: 1px solid #E1E7EA !important;
      box-shadow: 0 -10px 28px rgba(38,52,61,.14) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="선택지로 플레이하기"]
      ) > div[class*="bg-gray-sub1"] > div:first-child svg {
      color: #C1CBD0 !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="선택지로 플레이하기"] {
      background: #FFFFFF !important;
      color: #26343C !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="선택지로 플레이하기"] > div:first-child {
      background: #F5F7F8 !important;
      border: 1px solid #E5EAED !important;
      color: #26343C !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="선택지로 플레이하기"] > div:first-child > div {
      background: transparent !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="선택지로 플레이하기"] .text-gray-200,
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="선택지로 플레이하기"] .body2 {
      color: #26343C !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="선택지로 플레이하기"] > span.caption1 {
      color: #718087 !important;
    }

    /* 선택지 토글 ON */
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="선택지로 플레이하기"]
      button[aria-label="선택지로 플레이하기"] > div[class*="bg-primary-"] {
      background: var(--kt-yellow) !important;
      box-shadow: inset 0 0 0 1px rgba(168,149,0,.15) !important;
    }

    /* 선택지 토글 OFF */
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="선택지로 플레이하기"]
      button[aria-label="선택지로 플레이하기"] > div:not([class*="bg-primary-"]) {
      background: #CDD4D8 !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="선택지로 플레이하기"]
      button[aria-label="선택지로 플레이하기"] > div > div {
      background: #FFFFFF !important;
      box-shadow: 0 1px 3px rgba(45,55,61,.20) !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="선택지로 플레이하기"] > button:last-child {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E4CF00 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="선택지로 플레이하기"] > button:last-child:hover {
      background: var(--kt-yellow-hover) !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="선택지로 플레이하기"] > button:last-child span {
      color: #191919 !important;
    }


    /* =========================================================
       v3.21 - 책갈피 목록 / 편집 페이지
       /rooms/.../bookmarks
    ========================================================= */

    html.kt-bookmark-active,
    html.kt-bookmark-active body {
      background: var(--kt-chat) !important;
      color-scheme: light !important;
    }

    html.kt-bookmark-active main#contents,
    html.kt-bookmark-active [data-sentry-component="BookmarkList"] {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
    }

    html.kt-bookmark-active [data-sentry-component="BookmarkList"] > header {
      background: #FFFFFF !important;
      color: #191919 !important;
      border-bottom: 1px solid #E6EAED !important;
      box-shadow: 0 1px 0 rgba(0,0,0,.02) !important;
    }

    html.kt-bookmark-active [data-sentry-component="BookmarkList"] > header nav {
      background: transparent !important;
    }

    html.kt-bookmark-active [data-sentry-component="BookmarkList"] > header h3 {
      color: #202124 !important;
    }

    html.kt-bookmark-active [data-sentry-component="BookmarkList"] > header button {
      background: transparent !important;
      color: #4D5B63 !important;
    }

    html.kt-bookmark-active [data-sentry-component="BookmarkList"] > header button svg {
      color: #26343C !important;
    }

    /* 편집 / 완료 같은 우측 액션: 보라색 제거 */
    html.kt-bookmark-active [data-sentry-component="BookmarkList"] > header
      button[class*="text-primary-"] {
      color: #6B5F24 !important;
      font-weight: 600 !important;
    }

    /* 목록 스크롤 영역 */
    html.kt-bookmark-active [data-sentry-component="BookmarkList"]
      [data-sentry-component="WrappedDiv"] {
      background: #FFFFFF !important;
      scrollbar-width: thin !important;
      scrollbar-color: rgba(70,88,99,.18) transparent !important;
    }

    html.kt-bookmark-active [data-sentry-component="BookmarkList"]
      [data-sentry-component="WrappedDiv"]::-webkit-scrollbar {
      width: 5px !important;
    }

    html.kt-bookmark-active [data-sentry-component="BookmarkList"]
      [data-sentry-component="WrappedDiv"]::-webkit-scrollbar-thumb {
      background: rgba(70,88,99,.18) !important;
      border-radius: 999px !important;
    }

    /* 각 책갈피 행 */
    html.kt-bookmark-active [data-sentry-component="BookmarkListItem"] {
      background: #FFFFFF !important;
      color: #26343C !important;
    }

    html.kt-bookmark-active [data-sentry-component="BookmarkListItem"] > div {
      border-bottom-color: #E8ECEF !important;
    }

    html.kt-bookmark-active [data-sentry-component="BookmarkListItem"] .body14 {
      color: #35434B !important;
    }

    html.kt-bookmark-active [data-sentry-component="BookmarkListItem"]
      [class*="text-white/70"],
    html.kt-bookmark-active [data-sentry-component="BookmarkListItem"] .body12 {
      color: #6C7A82 !important;
    }

    /* 편집모드 수정/해제 */
    html.kt-bookmark-active [data-sentry-component="BookmarkListItem"] button {
      box-shadow: none !important;
      border: 1px solid #DFE5E8 !important;
    }

    html.kt-bookmark-active [data-sentry-component="BookmarkListItem"]
      .kt-bookmark-edit-button {
      background: #F2F4F5 !important;
      color: #3F4E57 !important;
    }

    html.kt-bookmark-active [data-sentry-component="BookmarkListItem"]
      .kt-bookmark-remove-button {
      background: #FFF1F1 !important;
      color: #C75151 !important;
      border-color: #F2D6D6 !important;
    }

    html.kt-bookmark-active [data-sentry-component="BookmarkListItem"]
      .kt-bookmark-edit-button:hover {
      background: #E9EDEF !important;
    }

    html.kt-bookmark-active [data-sentry-component="BookmarkListItem"]
      .kt-bookmark-remove-button:hover {
      background: #FBE6E6 !important;
    }


    /* =========================================================
       v3.22 - AI 모델 선택 바텀시트
    ========================================================= */

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="AI 모델 선택"]
      ) > [role="presentation"] {
      background: rgba(43,57,66,.28) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="AI 모델 선택"]
      ) > div[class*="bg-gray-sub1"] {
      background: #FFFFFF !important;
      color: #26343C !important;
      border-top: 1px solid #E1E7EA !important;
      box-shadow: 0 -10px 28px rgba(38,52,61,.14) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="AI 모델 선택"]
      ) > div[class*="bg-gray-sub1"] > div:first-child svg {
      color: #C1CBD0 !important;
    }

    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"] {
      background: #FFFFFF !important;
      color: #26343C !important;
    }

    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"] h2 {
      color: #26343C !important;
    }

    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"] p {
      color: #748188 !important;
    }

    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"] p a {
      color: #53646D !important;
      text-decoration-color: #8A979D !important;
    }

    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      > div:first-child > div:last-child > span {
      color: #4D5C64 !important;
    }

    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      > div:first-child > div:last-child > div {
      background: #D8DEE1 !important;
    }

    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      > div:first-child > div:last-child button {
      background: #FFF5AA !important;
      color: #5E541B !important;
      border-radius: 999px !important;
      padding: 4px 8px !important;
    }

    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      > div:first-child > div:last-child button span,
    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      > div:first-child > div:last-child button svg {
      color: #5E541B !important;
    }

    /* 모델 카드 */
    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] {
      background: #F5F7F8 !important;
      border: 1px solid #E1E6E9 !important;
      color: #26343C !important;
      box-shadow: 0 1px 3px rgba(45,61,71,.05) !important;
    }

    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"]:hover {
      background: #F0F3F5 !important;
    }

    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"][aria-checked="true"] {
      background: #FFF9C9 !important;
      border-color: #D9C84D !important;
      box-shadow: 0 0 0 1px rgba(217,200,77,.10) !important;
    }

    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] .text-gray-200 {
      color: #2E3A40 !important;
    }

    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] [class*="text-primary-"] {
      color: #6C6124 !important;
    }

    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] > svg {
      color: #5B6870 !important;
    }

    /* 모델 로고 원본이 흰색 PNG라 라이트 카드에서는 검게 반전 */
    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] img[alt="zeta"],
    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] img[alt="koji"],
    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] img[alt="luca"] {
      filter: invert(1) !important;
    }


    /* =========================================================
       v3.22 - 이어하기 목록
       /plots/.../saved-rooms
    ========================================================= */

    html.kt-saved-rooms-active main {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Header"] {
      background: #FFFFFF !important;
      color: #202124 !important;
      border-bottom-color: #E5EAED !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Header"] nav {
      background: transparent !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Header"] h3 {
      color: #202124 !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Header"] button,
    html.kt-saved-rooms-active [data-sentry-component="Header"] svg {
      color: #26343C !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="SavedRoomListPage"],
    html.kt-saved-rooms-active [data-sentry-component="SavedRoomListPage"]
      [data-sentry-component="WrappedDiv"] {
      background: #FFFFFF !important;
      color: #26343C !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="SavedRoomListHeader"] {
      background: #FAFBFB !important;
      color: #7A878E !important;
      border-bottom-color: #E7EBEE !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="SavedRoomListPage"] a {
      background: #FFFFFF !important;
      border-color: #E7EBEE !important;
      border-radius: 10px !important;
      color: #26343C !important;
    }

    html.kt-saved-rooms-active [data-sentry-source-file="SavedRoomItem.tsx"]
      .text-gray-50 {
      color: #28363E !important;
    }

    html.kt-saved-rooms-active [data-sentry-source-file="SavedRoomItem.tsx"]
      [class*="text-white/50"] {
      color: #7B888F !important;
    }

    html.kt-saved-rooms-active [data-sentry-source-file="SavedRoomItem.tsx"]
      [class*="text-white/[16%]"] {
      color: #C0C7CB !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="SavedRoomListPage"] a > button,
    html.kt-saved-rooms-active [data-sentry-component="SavedRoomListPage"] a > button svg {
      color: #66757D !important;
    }


    /* =========================================================
       v3.22 - 저장된 대화 제목 수정 팝업
    ========================================================= */

    html.kt-saved-rooms-active [data-sentry-component="Popup"] {
      background: rgba(43,57,66,.34) !important;
      backdrop-filter: blur(8px) !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Popup"] > div {
      background: #FFFFFF !important;
      color: #26343C !important;
      border: 1px solid #E1E6E9 !important;
      box-shadow: 0 16px 40px rgba(38,52,61,.18) !important;

      /* 원래 레이아웃 보존 */
      box-sizing: border-box !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Popup"] h5 {
      color: #202124 !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Popup"]
      label[data-sentry-component="Input"] {
      background: #F5F7F8 !important;
      color: #202124 !important;
      border-color: #DCE3E7 !important;
      box-shadow: none !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Popup"]
      label[data-sentry-component="Input"]:focus-within {
      background: #FFFFFF !important;
      border-color: #D2C24C !important;
      box-shadow: 0 0 0 3px rgba(254,229,0,.18) !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Popup"]
      input[data-sentry-component="Input"] {
      background: transparent !important;
      color: #202124 !important;
      caret-color: #3D474C !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Popup"]
      input[data-sentry-component="Input"]::placeholder {
      color: #99A2A7 !important;
      opacity: 1 !important;
    }

    /* 입력창 X */
    html.kt-saved-rooms-active [data-sentry-component="Popup"]
      label[data-sentry-component="Input"] > button {
      background: #D9DEE1 !important;
      color: #66757D !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Popup"]
      label[data-sentry-component="Input"] > button svg {
      color: #66757D !important;
    }

    /* 하단 버튼 */
    html.kt-saved-rooms-active [data-sentry-component="Popup"]
      [data-sentry-source-file="Popup.tsx"] > button:first-child {
      background: #ECEFF1 !important;
      color: #46545E !important;
      border: 1px solid #E0E5E8 !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Popup"]
      [data-sentry-source-file="Popup.tsx"] > button:last-child {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E4CF00 !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Popup"]
      [data-sentry-source-file="Popup.tsx"] > button:last-child:hover {
      background: var(--kt-yellow-hover) !important;
    }


    /* =========================================================
       v3.22 - 저장된 대화 상세
       /plots/.../saved-rooms/...
    ========================================================= */

    html.kt-saved-room-active,
    html.kt-saved-room-active body {
      background: var(--kt-chat) !important;
      color-scheme: light !important;
    }

    html.kt-saved-room-active main {
      background: var(--kt-chat) !important;
      color: var(--kt-text) !important;
    }

    html.kt-saved-room-active [data-sentry-component="SavedRoomHeader"]
      [data-sentry-component="Header"] {
      background: #FFFFFF !important;
      color: #202124 !important;
      border-bottom-color: #E3E8EB !important;
    }

    html.kt-saved-room-active [data-sentry-component="SavedRoomHeader"] h3 {
      color: #202124 !important;
    }

    html.kt-saved-room-active [data-sentry-component="SavedRoomHeader"] button,
    html.kt-saved-room-active [data-sentry-component="SavedRoomHeader"] svg {
      color: #26343C !important;
    }

    html.kt-saved-room-active [data-sentry-component="ChatMessageList"] {
      background: var(--kt-chat) !important;
      color: var(--kt-text) !important;
      scrollbar-width: thin !important;
      scrollbar-color: rgba(65,84,95,.18) transparent !important;
    }

    /* 상대 이름 / 말풍선 */
    html.kt-saved-room-active [data-sentry-component="LeftContentView"]
      .caption1 {
      color: var(--kt-ai-name) !important;
    }

    html.kt-saved-room-active [data-sentry-component="LeftContentView"]
      [data-sentry-component="ChatBubbleContainer"] {
      background: #FFFFFF !important;
      color: var(--kt-ai-dialogue) !important;
      border: 0 !important;
      box-shadow: 0 1px 2px rgba(0,0,0,.05) !important;
    }

    html.kt-saved-room-active [data-sentry-component="LeftContentView"]
      [data-sentry-component="ChatBubbleContainer"] .chat,
    html.kt-saved-room-active [data-sentry-component="LeftContentView"]
      [data-sentry-component="ChatBubbleContainer"] p {
      color: var(--kt-ai-dialogue) !important;
    }

    html.kt-saved-room-active [data-sentry-component="LeftContentView"]
      [data-sentry-component="ChatBubbleContainer"] em {
      color: #61717A !important;
    }

    /* 내 이름 / 말풍선 */
    html.kt-saved-room-active [data-sentry-component="RightContentView"]
      .caption1,
    html.kt-saved-room-active [data-sentry-component="RightContentView"]
      > div > div:first-child {
      color: var(--kt-user-name) !important;
    }

    html.kt-saved-room-active [data-sentry-component="RightContentView"]
      [data-sentry-component="ChatBubbleContainer"] {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 0 !important;
      box-shadow: 0 1px 2px rgba(0,0,0,.05) !important;
    }

    html.kt-saved-room-active [data-sentry-component="RightContentView"]
      [data-sentry-component="ChatBubbleContainer"] .chat,
    html.kt-saved-room-active [data-sentry-component="RightContentView"]
      [data-sentry-component="ChatBubbleContainer"] p {
      color: #191919 !important;
    }

    html.kt-saved-room-active [data-sentry-component="RightContentView"]
      [data-sentry-component="ChatBubbleContainer"] em,
    html.kt-saved-room-active [data-sentry-component="RightContentView"]
      [data-sentry-component="ChatBubbleContainer"] [class*="text-primary-"] {
      color: var(--kt-user-action) !important;
    }

    /* 내레이터: 박스 제거 + 글씨만 진하게 */
    html.kt-saved-room-active [data-sentry-component="NarratorBubble"] > div {
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
    }

    html.kt-saved-room-active [data-sentry-component="NarratorBubble"] .chat,
    html.kt-saved-room-active [data-sentry-component="NarratorBubble"] p,
    html.kt-saved-room-active [data-sentry-component="NarratorBubble"] em,
    html.kt-saved-room-active [data-sentry-component="NarratorBubble"] li {
      color: #4E5C64 !important;
    }

    html.kt-saved-room-active [data-sentry-component="NarratorBubble"] strong,
    html.kt-saved-room-active [data-sentry-component="NarratorBubble"] svg {
      color: #36464F !important;
    }

    /* 상태창: 배경 제거 */
    html.kt-saved-room-active [data-sentry-component="InfoBoxContentView"] {
      background: transparent !important;
      color: #4B5961 !important;
      border: 0 !important;
      box-shadow: none !important;
    }

    html.kt-saved-room-active [data-sentry-component="InfoBoxContentView"]
      [data-sentry-component="InfoBoxContent"],
    html.kt-saved-room-active [data-sentry-component="InfoBoxContentView"]
      .chat,
    html.kt-saved-room-active [data-sentry-component="InfoBoxContentView"]
      [class*="text-white/"] {
      color: #4B5961 !important;
    }

    html.kt-saved-room-active [data-sentry-component="InfoBoxContentView"]
      .font-bold,
    html.kt-saved-room-active [data-sentry-component="InfoBoxContentView"]
      .font-semibold {
      color: #34434C !important;
    }

    html.kt-saved-room-active [data-sentry-component="InfoBoxContentView"] svg {
      color: #52616A !important;
    }

    /* 하단 이어하기 버튼 */
    html.kt-saved-room-active main
      > div > div:last-child > button:last-child,
    html.kt-saved-room-active button.kt-saved-room-continue {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E4CF00 !important;
      box-shadow: none !important;
    }

    html.kt-saved-room-active main
      > div > div:last-child > button:last-child:hover,
    html.kt-saved-room-active button.kt-saved-room-continue:hover {
      background: var(--kt-yellow-hover) !important;
    }



    /* =========================================================
       v3.23 - 구조 기반 fallback
       저장 페이지/팝업은 경로 클래스가 늦게 붙어도 바로 적용
    ========================================================= */

    html:has(textarea[aria-label="내용 입력하기"]) [data-testid="action-panel-button"] {
      background: rgba(255,255,255,.94) !important;
      color: #40515A !important;
      border: 1px solid rgba(64,81,90,.16) !important;
      box-shadow: 0 1px 4px rgba(39,55,64,.10) !important;
    }

    html:has(textarea[aria-label="내용 입력하기"]) [data-testid="action-panel-button"]:hover {
      background: #FFFFFF !important;
      border-color: rgba(64,81,90,.22) !important;
    }

    html:has(textarea[aria-label="내용 입력하기"]) [data-testid="action-panel-button"] svg {
      color: #40515A !important;
    }

    html:has(textarea[aria-label="내용 입력하기"]) [data-testid="chat-header-model"],
    html:has(textarea[aria-label="내용 입력하기"]) button[aria-label="Select AI model"] {
      background: #F5F6F7 !important;
      color: #26343C !important;
      border: 1px solid #E1E6E9 !important;
      box-shadow: none !important;
    }

    html:has(textarea[aria-label="내용 입력하기"]) [data-testid="chat-header-model"] svg,
    html:has(textarea[aria-label="내용 입력하기"]) button[aria-label="Select AI model"] svg {
      color: #5F6D75 !important;
    }

    html:has(#portal-container section[role="dialog"][aria-label="AI 모델 선택"]) #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="AI 모델 선택"]
      ) > [role="presentation"] {
      background: rgba(43,57,66,.28) !important;
    }

    html:has(#portal-container section[role="dialog"][aria-label="AI 모델 선택"]) #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="AI 모델 선택"]
      ) > div[class*="bg-gray-sub1"] {
      background: #FFFFFF !important;
      color: #26343C !important;
      border-top: 1px solid #E1E7EA !important;
      box-shadow: 0 -10px 28px rgba(38,52,61,.14) !important;
    }

    html:has(#portal-container section[role="dialog"][aria-label="AI 모델 선택"]) #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="AI 모델 선택"]
      ) > div[class*="bg-gray-sub1"] > div:first-child svg {
      color: #C1CBD0 !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"] {
      background: #FFFFFF !important;
      color: #26343C !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"] h2 {
      color: #26343C !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"] p {
      color: #748188 !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"] p a {
      color: #53646D !important;
      text-decoration-color: #8A979D !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"]
      > div:first-child > div:last-child > span {
      color: #4D5C64 !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"]
      > div:first-child > div:last-child > div {
      background: #D8DEE1 !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"]
      > div:first-child > div:last-child button {
      background: #FFF5AA !important;
      color: #5E541B !important;
      border-radius: 999px !important;
      padding: 4px 8px !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"]
      > div:first-child > div:last-child button span,
    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"]
      > div:first-child > div:last-child button svg {
      color: #5E541B !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] {
      background: #F5F7F8 !important;
      border: 1px solid #E1E6E9 !important;
      color: #26343C !important;
      box-shadow: 0 1px 3px rgba(45,61,71,.05) !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"]:hover {
      background: #F0F3F5 !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"][aria-checked="true"] {
      background: #FFF9C9 !important;
      border-color: #D9C84D !important;
      box-shadow: 0 0 0 1px rgba(217,200,77,.10) !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] .text-gray-200 {
      color: #2E3A40 !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] [class*="text-primary-"] {
      color: #6C6124 !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] > svg {
      color: #5B6870 !important;
    }

    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] img[alt="zeta"],
    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] img[alt="koji"],
    html:has(section[role="dialog"][aria-label="AI 모델 선택"]) section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] img[alt="luca"] {
      filter: invert(1) !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]),
    html:has([data-sentry-component="SavedRoomHeader"]) {
      background: var(--kt-chat) !important;
      color-scheme: light !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) body,
    html:has([data-sentry-component="SavedRoomHeader"]) body {
      background: var(--kt-chat) !important;
      color: var(--kt-text) !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) main,
    html:has([data-sentry-component="SavedRoomHeader"]) main {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Header"],
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="SavedRoomHeader"] [data-sentry-component="Header"] {
      background: #FFFFFF !important;
      color: #202124 !important;
      border-bottom-color: #E5EAED !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Header"] nav,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="SavedRoomHeader"] [data-sentry-component="Header"] nav {
      background: transparent !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Header"] h3,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="SavedRoomHeader"] h3 {
      color: #202124 !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Header"] button,
    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Header"] svg,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="SavedRoomHeader"] button,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="SavedRoomHeader"] svg {
      color: #26343C !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="SavedRoomListPage"],
    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="SavedRoomListPage"] [data-sentry-component="WrappedDiv"] {
      background: #FFFFFF !important;
      color: #26343C !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="SavedRoomListHeader"] {
      background: #FAFBFB !important;
      color: #7A878E !important;
      border-bottom-color: #E7EBEE !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="SavedRoomListPage"] a {
      background: #FFFFFF !important;
      border-color: #E7EBEE !important;
      border-radius: 10px !important;
      color: #26343C !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="SavedRoomListPage"] a:hover {
      background: #F6F8F9 !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-source-file="SavedRoomItem.tsx"] .text-gray-50 {
      color: #28363E !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-source-file="SavedRoomItem.tsx"] [class*="text-white/50"] {
      color: #7B888F !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-source-file="SavedRoomItem.tsx"] [class*="text-white/[16%]"] {
      color: #C0C7CB !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="SavedRoomListPage"] a > button,
    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="SavedRoomListPage"] a > button svg {
      color: #66757D !important;
    }

    html:has([data-sentry-component="SavedRoomHeader"]) main {
      background: var(--kt-chat) !important;
      color: var(--kt-text) !important;
    }

    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="ChatMessageList"] {
      background: var(--kt-chat) !important;
      color: var(--kt-text) !important;
      scrollbar-width: thin !important;
      scrollbar-color: rgba(65,84,95,.18) transparent !important;
    }

    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="LeftContentView"] .caption1 {
      color: var(--kt-ai-name) !important;
    }

    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="LeftContentView"]
      [data-sentry-component="ChatBubbleContainer"] {
      background: #FFFFFF !important;
      color: var(--kt-ai-dialogue) !important;
      border: 0 !important;
      box-shadow: 0 1px 2px rgba(0,0,0,.05) !important;
    }

    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="LeftContentView"]
      [data-sentry-component="ChatBubbleContainer"] .chat,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="LeftContentView"]
      [data-sentry-component="ChatBubbleContainer"] p {
      color: var(--kt-ai-dialogue) !important;
    }

    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="RightContentView"] .caption1,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="RightContentView"] > div > div:first-child {
      color: var(--kt-user-name) !important;
    }

    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="RightContentView"]
      [data-sentry-component="ChatBubbleContainer"] {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 0 !important;
      box-shadow: 0 1px 2px rgba(0,0,0,.05) !important;
    }

    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="RightContentView"]
      [data-sentry-component="ChatBubbleContainer"] .chat,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="RightContentView"]
      [data-sentry-component="ChatBubbleContainer"] p {
      color: #191919 !important;
    }

    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="NarratorBubble"] > div,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="InfoBoxContentView"] {
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
    }

    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="NarratorBubble"] .chat,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="NarratorBubble"] p,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="NarratorBubble"] em,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="NarratorBubble"] li,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="InfoBoxContentView"],
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="InfoBoxContentView"] [data-sentry-component="InfoBoxContent"],
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="InfoBoxContentView"] .chat,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="InfoBoxContentView"] [class*="text-white/"] {
      color: #4B5961 !important;
    }

    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="NarratorBubble"] strong,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="NarratorBubble"] svg,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="InfoBoxContentView"] .font-bold,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="InfoBoxContentView"] .font-semibold {
      color: #34434C !important;
    }

    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="InfoBoxContentView"] svg {
      color: #52616A !important;
    }

    html:has([data-sentry-component="SavedRoomHeader"]) main > div > div:last-child > button:last-child,
    html:has([data-sentry-component="SavedRoomHeader"]) button.kt-saved-room-continue {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E4CF00 !important;
      box-shadow: none !important;
    }

    html:has([data-sentry-component="SavedRoomHeader"]) main > div > div:last-child > button:last-child:hover,
    html:has([data-sentry-component="SavedRoomHeader"]) button.kt-saved-room-continue:hover {
      background: var(--kt-yellow-hover) !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Popup"],
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="Popup"] {
      background: rgba(43,57,66,.34) !important;
      backdrop-filter: blur(8px) !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Popup"] > div,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="Popup"] > div {
      background: #FFFFFF !important;
      color: #26343C !important;
      border: 1px solid #E1E6E9 !important;
      box-shadow: 0 16px 40px rgba(38,52,61,.18) !important;
      box-sizing: border-box !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Popup"] h5,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="Popup"] h5 {
      color: #202124 !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Popup"]
      label[data-sentry-component="Input"],
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="Popup"]
      label[data-sentry-component="Input"] {
      background: #F5F7F8 !important;
      color: #202124 !important;
      border-color: #DCE3E7 !important;
      box-shadow: none !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Popup"]
      label[data-sentry-component="Input"]:focus-within,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="Popup"]
      label[data-sentry-component="Input"]:focus-within {
      background: #FFFFFF !important;
      border-color: #D2C24C !important;
      box-shadow: 0 0 0 3px rgba(254,229,0,.18) !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Popup"]
      input[data-sentry-component="Input"],
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="Popup"]
      input[data-sentry-component="Input"] {
      background: transparent !important;
      color: #202124 !important;
      caret-color: #3D474C !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Popup"]
      input[data-sentry-component="Input"]::placeholder,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="Popup"]
      input[data-sentry-component="Input"]::placeholder {
      color: #99A2A7 !important;
      opacity: 1 !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Popup"]
      label[data-sentry-component="Input"] > button,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="Popup"]
      label[data-sentry-component="Input"] > button {
      background: #D9DEE1 !important;
      color: #66757D !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Popup"]
      label[data-sentry-component="Input"] > button svg,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="Popup"]
      label[data-sentry-component="Input"] > button svg {
      color: #66757D !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Popup"]
      [data-sentry-source-file="Popup.tsx"] > button:first-child,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="Popup"]
      [data-sentry-source-file="Popup.tsx"] > button:first-child {
      background: #ECEFF1 !important;
      color: #46545E !important;
      border: 1px solid #E0E5E8 !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Popup"]
      [data-sentry-source-file="Popup.tsx"] > button:last-child,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="Popup"]
      [data-sentry-source-file="Popup.tsx"] > button:last-child {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E4CF00 !important;
    }

    html:has([data-sentry-component="SavedRoomListPage"]) [data-sentry-component="Popup"]
      [data-sentry-source-file="Popup.tsx"] > button:last-child:hover,
    html:has([data-sentry-component="SavedRoomHeader"]) [data-sentry-component="Popup"]
      [data-sentry-source-file="Popup.tsx"] > button:last-child:hover {
      background: var(--kt-yellow-hover) !important;
    }

    /* =========================================================
       v3.23 - 1번: 상단 AI 모델(플러그인) 버튼
       "zeta / koji / luca" 버튼 자체 보정
    ========================================================= */

    html.${ACTIVE} [data-testid="chat-header-model"] {
      background: #F3F5F6 !important;
      color: #2E3A40 !important;
      border: 1px solid #DDE3E6 !important;
      box-shadow: 0 1px 3px rgba(45,61,71,.08) !important;
    }

    html.${ACTIVE} [data-testid="chat-header-model"]:hover {
      background: #FFF8C7 !important;
      border-color: #E5D45B !important;
    }

    html.${ACTIVE} [data-testid="chat-header-model"] span,
    html.${ACTIVE} [data-testid="chat-header-model"] strong {
      color: #2E3A40 !important;
    }

    html.${ACTIVE} [data-testid="chat-header-model"] svg {
      color: #69777F !important;
    }


    /* =========================================================
       v3.23 - 1번: AI 모델 선택 바텀시트 최종 보정
       레이아웃은 그대로, 색만 카톡 라이트 톤
    ========================================================= */

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="AI 모델 선택"]
      ) {
      color: #26343C !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="AI 모델 선택"]
      ) > [role="presentation"] {
      background: rgba(43,57,66,.30) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        section[role="dialog"][aria-label="AI 모델 선택"]
      ) > div[class*="bg-gray-sub1"] {
      background: #FFFFFF !important;
      color: #26343C !important;
      border-top: 1px solid #DFE5E8 !important;
      box-shadow: 0 -12px 30px rgba(38,52,61,.14) !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="AI 모델 선택"] {
      background: #FFFFFF !important;
      color: #26343C !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="AI 모델 선택"] h2 {
      color: #26343C !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="AI 모델 선택"] p,
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="AI 모델 선택"] [class*="text-white/"] {
      color: #748188 !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] {
      background: #F5F7F8 !important;
      color: #26343C !important;
      border: 1px solid #E1E6E9 !important;
      box-shadow: 0 1px 3px rgba(45,61,71,.05) !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"]:hover {
      background: #F0F3F5 !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"][aria-checked="true"],
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"][class*="border-primary-"] {
      background: #FFF8BF !important;
      border-color: #D8C94D !important;
      color: #2E3A40 !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] .text-gray-200,
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] [class*="text-white"] {
      color: #2F3B42 !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] [class*="text-primary-"] {
      color: #6E6323 !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] > svg {
      color: #55646D !important;
    }

    /* 보유 피스 / 충전 링크도 보라색 대신 노랑 포인트 */
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="AI 모델 선택"]
      button:has(span):not([data-sentry-component="ModelItem"]) {
      color: #5F5520 !important;
    }


    /* =========================================================
       v3.23 - 2번: 이어하기 목록
    ========================================================= */

    html.kt-saved-rooms-active,
    html.kt-saved-rooms-active body {
      background: var(--kt-chat) !important;
      color-scheme: light !important;
    }

    html.kt-saved-rooms-active main,
    html.kt-saved-rooms-active [data-sentry-component="SavedRoomListPage"],
    html.kt-saved-rooms-active [data-sentry-component="SavedRoomListPage"]
      [data-sentry-component="WrappedDiv"] {
      background: #FFFFFF !important;
      color: #26343C !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Header"] {
      background: #FFFFFF !important;
      color: #202124 !important;
      border-bottom: 1px solid #E5EAED !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="Header"] h3,
    html.kt-saved-rooms-active [data-sentry-component="Header"] button,
    html.kt-saved-rooms-active [data-sentry-component="Header"] svg {
      color: #26343C !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="SavedRoomListHeader"] {
      background: #FAFBFB !important;
      color: #7A878E !important;
      border-bottom: 1px solid #E6EBEE !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="SavedRoomListPage"] a {
      background: #FFFFFF !important;
      color: #26343C !important;
      border-color: #E7EBEE !important;
    }

    html.kt-saved-rooms-active [data-sentry-component="SavedRoomListPage"] a:hover {
      background: #F6F8F9 !important;
    }

    html.kt-saved-rooms-active [data-sentry-source-file="SavedRoomItem.tsx"]
      .text-gray-50 {
      color: #2C3940 !important;
    }

    html.kt-saved-rooms-active [data-sentry-source-file="SavedRoomItem.tsx"]
      [class*="text-white/50"] {
      color: #77858C !important;
    }

    html.kt-saved-rooms-active [data-sentry-source-file="SavedRoomItem.tsx"]
      button,
    html.kt-saved-rooms-active [data-sentry-source-file="SavedRoomItem.tsx"]
      button svg {
      color: #69777F !important;
      background: transparent !important;
    }


    /* =========================================================
       v3.23 - 3번: 저장 대화 제목 수정 팝업
       원래 343px 레이아웃/패딩은 절대 건드리지 않음
    ========================================================= */

    html.kt-saved-rooms-active #portal-container
      [data-sentry-component="Popup"] {
      background: rgba(43,57,66,.34) !important;
      backdrop-filter: blur(8px) !important;
    }

    html.kt-saved-rooms-active #portal-container
      [data-sentry-component="Popup"] > div[data-sentry-source-file="Popup.tsx"] {
      background: #FFFFFF !important;
      color: #26343C !important;
      border-color: #E1E6E9 !important;
      box-shadow: 0 16px 40px rgba(38,52,61,.18) !important;
      box-sizing: border-box !important;
    }

    html.kt-saved-rooms-active #portal-container
      [data-sentry-component="Popup"] h5 {
      color: #202124 !important;
    }

    html.kt-saved-rooms-active #portal-container
      [data-sentry-component="Popup"]
      label[data-sentry-component="Input"] {
      background: #F5F7F8 !important;
      color: #202124 !important;
      border: 1px solid #DCE3E7 !important;
      box-shadow: none !important;
    }

    html.kt-saved-rooms-active #portal-container
      [data-sentry-component="Popup"]
      label[data-sentry-component="Input"]:focus-within {
      background: #FFFFFF !important;
      border-color: #D2C24C !important;
      box-shadow: 0 0 0 3px rgba(254,229,0,.18) !important;
    }

    html.kt-saved-rooms-active #portal-container
      [data-sentry-component="Popup"]
      input[data-sentry-component="Input"] {
      background: transparent !important;
      color: #202124 !important;
      caret-color: #3D474C !important;
    }

    html.kt-saved-rooms-active #portal-container
      [data-sentry-component="Popup"]
      input[data-sentry-component="Input"]::placeholder {
      color: #98A1A6 !important;
      opacity: 1 !important;
    }

    html.kt-saved-rooms-active #portal-container
      [data-sentry-component="Popup"]
      label[data-sentry-component="Input"] > button {
      background: #DCE1E4 !important;
      color: #65747C !important;
      border: 0 !important;
    }

    html.kt-saved-rooms-active #portal-container
      [data-sentry-component="Popup"]
      label[data-sentry-component="Input"] > button svg {
      color: #65747C !important;
    }

    /* 팝업 하단 취소/완료 */
    html.kt-saved-rooms-active #portal-container
      [data-sentry-component="Popup"]
      button.kt-saved-title-cancel {
      background: #ECEFF1 !important;
      color: #46545E !important;
      border: 1px solid #E0E5E8 !important;
    }

    html.kt-saved-rooms-active #portal-container
      [data-sentry-component="Popup"]
      button.kt-saved-title-submit {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E4CF00 !important;
    }

    html.kt-saved-rooms-active #portal-container
      [data-sentry-component="Popup"]
      button.kt-saved-title-submit:hover {
      background: var(--kt-yellow-hover) !important;
    }


    /* =========================================================
       v3.24 - 1/2 저장 대화 제목 수정 / 대화 삭제 드롭다운
       저장 목록과 저장 대화 상세에서 공통 적용
    ========================================================= */

    html [data-sentry-source-file="DropdownMenu.tsx"]:has(#edit-title):has(#delete-room) {
      background: #FFFFFF !important;
      border: 1px solid #DDE4E8 !important;
      border-radius: 12px !important;
      box-shadow: 0 8px 22px rgba(38,52,61,.16) !important;
      overflow: hidden !important;
    }

    html [data-sentry-source-file="DropdownMenu.tsx"]:has(#edit-title):has(#delete-room)
      [data-sentry-component="DropdownMenuItem"] {
      background: #FFFFFF !important;
      border-color: #E7EBEE !important;
    }

    html [data-sentry-source-file="DropdownMenu.tsx"]:has(#edit-title):has(#delete-room)
      [data-sentry-component="DropdownMenuItem"]:hover {
      background: #F6F8F9 !important;
    }

    html #edit-title,
    html #delete-room {
      background: transparent !important;
      box-shadow: none !important;
    }

    html #edit-title span {
      color: #34434C !important;
    }

    html #delete-room span {
      color: #C94F4F !important;
    }

    html #delete-room:hover {
      background: #FFF3F3 !important;
    }


    /* =========================================================
       v3.24 - 3 스냅샷 15피스 확인 팝업
    ========================================================= */

    html .kt-snapshot-confirm-layer {
      background: rgba(43,57,66,.34) !important;
      backdrop-filter: blur(8px) !important;
    }

    html .kt-snapshot-confirm-dialog {
      background: #FFFFFF !important;
      color: #26343C !important;
      border: 1px solid #DEE5E9 !important;
      border-radius: 16px !important;
      box-shadow: 0 18px 44px rgba(35,50,59,.22) !important;
    }

    html .kt-snapshot-confirm-dialog h1,
    html .kt-snapshot-confirm-dialog h2,
    html .kt-snapshot-confirm-dialog h3,
    html .kt-snapshot-confirm-dialog h4,
    html .kt-snapshot-confirm-dialog h5,
    html .kt-snapshot-confirm-dialog p,
    html .kt-snapshot-confirm-dialog span {
      color: #34434C !important;
    }

    html .kt-snapshot-confirm-dialog [class*="text-white/"],
    html .kt-snapshot-confirm-dialog [class*="text-gray-"],
    html .kt-snapshot-confirm-dialog .caption1,
    html .kt-snapshot-confirm-dialog .body14,
    html .kt-snapshot-confirm-dialog .body16 {
      color: #66757D !important;
    }

    html .kt-snapshot-confirm-dialog [class*="text-primary-"] {
      color: #6A5F20 !important;
    }

    html .kt-snapshot-confirm-dialog a {
      color: #53646D !important;
      text-decoration-color: #8A979D !important;
    }

    html .kt-snapshot-confirm-dialog .kt-dialog-confirm {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E2CB00 !important;
    }

    html .kt-snapshot-confirm-dialog .kt-dialog-cancel {
      background: #ECEFF1 !important;
      color: #46545E !important;
      border: 1px solid #E0E5E8 !important;
    }

    html .kt-snapshot-confirm-dialog .kt-dialog-checkrow,
    html .kt-snapshot-confirm-dialog .kt-dialog-checkrow span,
    html .kt-snapshot-confirm-dialog .kt-dialog-checkrow svg {
      color: #46545E !important;
    }

    html .kt-snapshot-confirm-dialog .kt-dialog-checkrow input[type="checkbox"] {
      accent-color: var(--kt-yellow) !important;
    }


    /* =========================================================
       v3.24 - 4 스냅샷 버튼
       Zeta 신형 DOM은 아이콘 wrapper span 없이 SVG가 바로 들어옴
    ========================================================= */

    html.${ACTIVE} [data-testid="snapshot-action-button"] {
      width: 32px !important;
      height: 32px !important;
      min-width: 32px !important;
      min-height: 32px !important;
      border-radius: 999px !important;
      background: #EEF1F3 !important;
      color: #53636C !important;
      border: 1px solid #E0E6E9 !important;
      box-shadow: 0 1px 3px rgba(45,61,71,.08) !important;
    }

    html.${ACTIVE} [data-testid="snapshot-action-button"]:hover {
      background: #E7ECEF !important;
    }

    html.${ACTIVE} [data-testid="snapshot-action-button"] > svg,
    html.${ACTIVE} [data-testid="snapshot-action-button"] svg {
      color: #53636C !important;
    }

    /* 가격 텍스트는 DOM 구조가 바뀌어도 마지막 span이면 무조건 숨김 */
    html.${ACTIVE} [data-testid="snapshot-action-button"] > span:last-child {
      display: none !important;
    }


    /* =========================================================
       v3.24 - 5 스냅샷 생성 중 카드
    ========================================================= */

    html .kt-snapshot-loading-card {
      background: rgba(255,255,255,.94) !important;
      color: #34434C !important;
      border: 1px solid #DDE5E9 !important;
      box-shadow: 0 5px 16px rgba(45,61,71,.10) !important;
    }

    html .kt-snapshot-loading-card p,
    html .kt-snapshot-loading-card span,
    html .kt-snapshot-loading-card div {
      color: #66757D !important;
    }

    html .kt-snapshot-loading-card strong,
    html .kt-snapshot-loading-card [class*="font-bold"],
    html .kt-snapshot-loading-card [class*="font-semibold"] {
      color: #34434C !important;
    }

    html .kt-snapshot-loading-card svg,
    html .kt-snapshot-loading-card [class*="text-primary-"] {
      color: #6F818B !important;
    }


    /* =========================================================
       v3.24 - 6 AI 모델 카드 설명 흰 글씨 보정
       선택 안 된 zeta/luca는 text-white/70을 사용함
    ========================================================= */

    html:has(section[role="dialog"][aria-label="AI 모델 선택"])
      section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] > div > span.mt-1,
    html.${ACTIVE} section[role="dialog"][aria-label="AI 모델 선택"]
      [data-sentry-component="ModelItem"] > div > span.mt-1 {
      color: #2E3A40 !important;
      opacity: 1 !important;
    }


    /* =========================================================
       v3.25 - 하단 액션 패널 아이콘/레이아웃 재보정
       v3.24에서 snapshot-action-button 자체를 32px 원으로 만든 규칙 취소.
       실제 DOM은 버튼 안 첫 span이 48px 원형 아이콘 wrapper임.
    ========================================================= */

    /* 액션 버튼 본체는 그리드 칸 전체를 정상 사용 */
    html.${ACTIVE} #portal-container
      [data-testid="action-panel-grid"] > button,
    html.${ACTIVE} #portal-container
      [data-testid="snapshot-action-button"] {
      width: auto !important;
      height: auto !important;
      min-width: 0 !important;
      min-height: 0 !important;
      border-radius: 12px !important;
      background: transparent !important;
      color: #394A54 !important;
      border: 0 !important;
      box-shadow: none !important;
      overflow: visible !important;
      padding: 8px 4px !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="action-panel-grid"] > button:hover,
    html.${ACTIVE} #portal-container
      [data-testid="snapshot-action-button"]:hover {
      background: #F7F9FA !important;
    }

    /* 스냅샷/일기 등 첫 span이 실제 원형 아이콘 배경 */
    html.${ACTIVE} #portal-container
      [data-testid="action-panel-grid"] > button > span:first-child {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 48px !important;
      height: 48px !important;
      min-width: 48px !important;
      min-height: 48px !important;
      flex: 0 0 48px !important;
      border-radius: 999px !important;
      background: #EEF1F3 !important;
      color: #53636C !important;
      border: 1px solid #E0E6E9 !important;
      box-shadow: 0 1px 3px rgba(45,61,71,.08) !important;
      overflow: hidden !important;
    }

    /* 원 안 아이콘: 흰색 클래스보다 강하게 덮어써서 보이게 */
    html.${ACTIVE} #portal-container
      [data-testid="action-panel-grid"] > button > span:first-child svg,
    html.${ACTIVE} #portal-container
      [data-testid="snapshot-action-button"] svg {
      display: block !important;
      width: 24px !important;
      height: 24px !important;
      color: #53636C !important;
      opacity: 1 !important;
      visibility: visible !important;
    }

    /* 버튼 라벨은 라이트 테마에서 읽히게 */
    html.${ACTIVE} #portal-container
      [data-testid="action-panel-grid"] > button > span:nth-child(2) {
      display: block !important;
      color: #394A54 !important;
      opacity: 1 !important;
    }

    /* 스냅샷의 세 번째 span만 가격(15피스)이므로 숨김 */
    html.${ACTIVE} #portal-container
      [data-testid="snapshot-action-button"] > span:nth-child(3) {
      display: none !important;
    }


    /* =========================================================
       v3.26 - 일기 목록 / 일기 본문
       채팅 화면의 하늘색, 흰색, 카카오 노랑 팔레트를 그대로 사용
    ========================================================= */

    html.${DIARY_ACTIVE} {
      background: var(--kt-chat) !important;
      color-scheme: light !important;
    }

    html.${DIARY_ACTIVE} body {
      background: #FFFFFF !important;
      color-scheme: light !important;
    }

    html.${DIARY_ACTIVE} [role="dialog"][aria-label="일기"],
    html.${DIARY_ACTIVE} [data-sentry-component="DiaryPanel"],
    html.${DIARY_ACTIVE} [data-testid="character-diary-safe-area"] {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
    }

    /* 공통 상단바 */
    html.${DIARY_ACTIVE} [data-sentry-component="DiaryPanel"] >
      [data-testid="character-diary-safe-area"] > header {
      background: var(--kt-white) !important;
      color: var(--kt-text) !important;
      border-bottom: 1px solid var(--kt-line) !important;
      box-shadow: 0 1px 3px rgba(45,61,71,.06) !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryPanel"] header h2,
    html.${DIARY_ACTIVE} [data-sentry-component="DiaryPanel"] header button,
    html.${DIARY_ACTIVE} [data-sentry-component="DiaryPanel"] header svg {
      color: var(--kt-text) !important;
    }

    /* 목록 화면 */
    html.${DIARY_ACTIVE} [data-sentry-component="DiaryCharacterList"] {
      color: var(--kt-text) !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryCharacterList"] > p,
    html.${DIARY_ACTIVE} [data-sentry-component="DiaryCharacterList"]
      > div > span,
    html.${DIARY_ACTIVE} [data-sentry-component="DiaryHistoryList"] > p {
      color: #62727C !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryCharacterList"] h3,
    html.${DIARY_ACTIVE} [data-sentry-component="DiaryCharacterList"]
      button[aria-current] > span:last-child {
      color: #26343C !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryCharacterList"]
      button[aria-current="true"] img {
      border-color: var(--kt-yellow) !important;
      --tw-ring-color: var(--kt-yellow) !important;
      --tw-ring-offset-color: #FFFFFF !important;
      box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px var(--kt-yellow) !important;
    }

    /* 새 일기 열기 */
    html.${DIARY_ACTIVE} [data-sentry-component="DiaryCharacterList"]
      > button[data-sentry-component="Button"] {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E4CF00 !important;
      box-shadow: 0 2px 5px rgba(91,82,16,.12) !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryCharacterList"]
      > button[data-sentry-component="Button"]:hover {
      background: var(--kt-yellow-hover) !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryCharacterList"]
      > button[data-sentry-component="Button"] span {
      color: #191919 !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryCharacterList"]
      > button[data-sentry-component="Button"] span:last-child {
      color: #776B19 !important;
    }

    /* 보유 일기 카드 */
    html.${DIARY_ACTIVE} [data-sentry-component="DiaryHistoryList"] li > button {
      background: rgba(255,255,255,.94) !important;
      color: #26343C !important;
      border: 1px solid rgba(69,87,97,.10) !important;
      box-shadow: 0 1px 3px rgba(45,61,71,.07) !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryHistoryList"] li > button:hover {
      background: #FFFFFF !important;
      border-color: rgba(69,87,97,.18) !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryHistoryList"]
      li > button > span:first-child {
      color: #75691D !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryHistoryList"]
      li > button > span:nth-child(2) {
      color: #26343C !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryHistoryList"] svg {
      color: #7A8991 !important;
    }

    /* 본문: 채팅 배경 위에 흰 종이 한 장 */
    html.${DIARY_ACTIVE} [data-sentry-component="DiaryPanel"]
      section[data-sentry-component="HorizontalScroll"] {
      background: #FFFFFF !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryReaderSlide"] {
      margin: 12px 12px 16px !important;
      padding: 24px 22px 32px !important;
      width: calc(100% - 24px) !important;
      min-height: calc(100% - 28px) !important;
      box-sizing: border-box !important;
      background: rgba(255,255,255,.96) !important;
      color: var(--kt-text) !important;
      border: 1px solid rgba(69,87,97,.10) !important;
      border-radius: 14px !important;
      box-shadow: 0 3px 10px rgba(45,61,71,.10) !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryReaderSlide"]
      > p:first-child,
    html.${DIARY_ACTIVE} [data-sentry-component="DiaryReaderSlide"]
      > p:first-child span {
      color: #667780 !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryReaderSlide"]
      > p:first-child span:last-child {
      color: #75691D !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryReaderSlide"] h3 {
      color: #202124 !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryReaderSlide"]
      > div.h-px {
      background: #DDE4E8 !important;
    }

    html.${DIARY_ACTIVE} [data-sentry-component="DiaryReaderSlide"]
      > div:last-child p {
      color: #34434C !important;
    }

    /* 페이지 표시 */
    html.${DIARY_ACTIVE} [data-testid="diary-pager-dots"] {
      background: #FFFFFF !important;
    }

    html.${DIARY_ACTIVE} [data-testid="diary-pager-dots"] > span {
      background: rgba(69,87,97,.28) !important;
    }

    html.${DIARY_ACTIVE} [data-testid="diary-pager-dots"]
      > span[class*="bg-primary-200"] {
      background: var(--kt-yellow) !important;
      box-shadow: 0 0 0 1px rgba(91,82,16,.10) !important;
    }


    /* =========================================================
       v3.27 - 엔딩 홈 / 보관 목록
    ========================================================= */

    html.${ENDING_ACTIVE},
    html.${ENDING_ACTIVE} body,
    html.${ENDING_ACTIVE} [role="dialog"][aria-label="엔딩"],
    html.${ENDING_ACTIVE} [data-sentry-component="EndingPanel"],
    html.${ENDING_ACTIVE} [data-sentry-component="EndingPanel"] > div,
    html.${ENDING_ACTIVE} [data-sentry-component="EndingHome"] {
      background: var(--kt-chat) !important;
      color: var(--kt-text) !important;
      color-scheme: light !important;
    }

    /* 상단바 */
    html.${ENDING_ACTIVE} [data-sentry-component="EndingHome"]
      > div:first-child {
      background: var(--kt-white) !important;
      color: var(--kt-text) !important;
      border-bottom: 1px solid var(--kt-line) !important;
      box-shadow: 0 1px 3px rgba(45,61,71,.06) !important;
    }

    html.${ENDING_ACTIVE} [data-sentry-component="EndingHome"]
      > div:first-child h2,
    html.${ENDING_ACTIVE} [data-sentry-component="EndingHome"]
      > div:first-child button,
    html.${ENDING_ACTIVE} [data-sentry-component="EndingHome"]
      > div:first-child svg {
      color: var(--kt-text) !important;
    }

    /* 이야기 마무리하기 */
    html.${ENDING_ACTIVE} [data-sentry-component="EndingHome"]
      > div:nth-child(2) > div:first-child > button {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E4CF00 !important;
      box-shadow: 0 2px 5px rgba(91,82,16,.12) !important;
    }

    html.${ENDING_ACTIVE} [data-sentry-component="EndingHome"]
      > div:nth-child(2) > div:first-child > button:hover {
      background: var(--kt-yellow-hover) !important;
    }

    /* 엔딩 모음 제목과 보관 수 */
    html.${ENDING_ACTIVE} [data-sentry-component="EndingArchiveList"]
      > div:first-child {
      margin: 0 16px !important;
      padding-left: 0 !important;
      padding-right: 0 !important;
      border-bottom: 1px solid rgba(69,87,97,.12) !important;
    }

    html.${ENDING_ACTIVE} [data-sentry-component="EndingArchiveList"] h3 {
      color: #26343C !important;
    }

    html.${ENDING_ACTIVE} [data-sentry-component="EndingArchiveList"]
      > div:first-child > span {
      color: #667780 !important;
    }

    /* 빈 상태 */
    html.${ENDING_ACTIVE} [data-sentry-component="EndingArchiveList"]
      > p:last-child:not(.sr-only) {
      margin: 0 16px 16px !important;
      color: #61727C !important;
      background: rgba(255,255,255,.48) !important;
      border: 1px dashed rgba(69,87,97,.18) !important;
      border-radius: 14px !important;
    }

    /* 엔딩이 생긴 뒤 표시되는 보관 카드도 같은 톤으로 처리 */
    html.${ENDING_ACTIVE} [data-sentry-component="EndingArchiveList"]
      ul {
      padding: 0 16px 16px !important;
    }

    html.${ENDING_ACTIVE} [data-sentry-component="EndingArchiveList"]
      li > button,
    html.${ENDING_ACTIVE} [data-sentry-component="EndingArchiveList"]
      a {
      background: rgba(255,255,255,.94) !important;
      color: #26343C !important;
      border-color: rgba(69,87,97,.10) !important;
      box-shadow: 0 1px 3px rgba(45,61,71,.07) !important;
    }

    html.${ENDING_ACTIVE} [data-sentry-component="EndingArchiveList"]
      li > button:hover,
    html.${ENDING_ACTIVE} [data-sentry-component="EndingArchiveList"]
      a:hover {
      background: #FFFFFF !important;
    }

    html.${ENDING_ACTIVE} [data-sentry-component="EndingArchiveList"]
      [class*="text-white"],
    html.${ENDING_ACTIVE} [data-sentry-component="EndingArchiveList"]
      [class*="text-gray-"] {
      color: #53646D !important;
    }

    html.${ENDING_ACTIVE} [data-sentry-component="EndingArchiveList"]
      [class*="text-primary-"] {
      color: #75691D !important;
    }


    /* =========================================================
       v3.28 - 채팅 선택지
       채팅 배경에서 확실히 분리되는 연노랑 인터랙션 카드
    ========================================================= */

    html.${ACTIVE} [data-sentry-component="CyoaChoiceList"]
      > div:first-child {
      background: linear-gradient(
        to bottom,
        rgba(255,255,255,0),
        rgba(255,255,255,.22) 28%,
        rgba(255,255,255,.34)
      ) !important;
      border-top-color: rgba(69,87,97,.14) !important;
    }

    /* 위쪽 드래그 손잡이 */
    html.${ACTIVE} [data-sentry-component="CyoaDraggablePanel"]
      > div:first-child > div:first-child {
      background: #60727C !important;
      box-shadow: 0 1px 2px rgba(45,61,71,.12) !important;
    }

    html.${ACTIVE} [data-sentry-component="CyoaDraggablePanel"]
      > div:first-child > div:last-child {
      color: #52636D !important;
    }

    /* 개별 선택지 */
    html.${ACTIVE} [data-sentry-component="CyoaChoiceItem"] {
      background: #FFF8BF !important;
      color: #302D1B !important;
      border: 1px solid #DFCA31 !important;
      box-shadow: 0 2px 6px rgba(91,82,16,.14) !important;
    }

    html.${ACTIVE} [data-sentry-component="CyoaChoiceItem"]:hover {
      background: #FFF3A0 !important;
      border-color: #CBB622 !important;
      box-shadow: 0 3px 8px rgba(91,82,16,.18) !important;
    }

    html.${ACTIVE} [data-sentry-component="CyoaChoiceItem"]
      .chat,
    html.${ACTIVE} [data-sentry-component="CyoaChoiceItem"]
      .chat p,
    html.${ACTIVE} [data-sentry-component="CyoaChoiceItem"]
      .chat span,
    html.${ACTIVE} [data-sentry-component="CyoaChoiceItem"]
      .chat em {
      color: #302D1B !important;
    }

    /* 선택지 편집 */
    html.${ACTIVE} [data-sentry-component="CyoaChoiceItem"]
      button[aria-label="Edit choice"] {
      min-width: 30px !important;
      min-height: 30px !important;
      padding: 7px !important;
      border-radius: 999px !important;
      background: rgba(206,183,22,.18) !important;
      color: #665B16 !important;
    }

    html.${ACTIVE} [data-sentry-component="CyoaChoiceItem"]
      button[aria-label="Edit choice"]:hover {
      background: rgba(206,183,22,.30) !important;
    }

    html.${ACTIVE} [data-sentry-component="CyoaChoiceItem"]
      button[aria-label="Edit choice"] svg {
      color: #665B16 !important;
      opacity: 1 !important;
    }

    /* 직접 입력 */
    html.${ACTIVE} [data-sentry-component="CyoaDraggablePanel"]
      > div:last-child > button:last-child {
      margin-top: 3px !important;
      padding: 5px 12px !important;
      color: #455761 !important;
      background: rgba(255,255,255,.82) !important;
      border: 1px solid rgba(69,87,97,.14) !important;
      border-radius: 999px !important;
      text-decoration: none !important;
    }

    html.${ACTIVE} [data-sentry-component="CyoaDraggablePanel"]
      > div:last-child > button:last-child:hover {
      background: #FFFFFF !important;
      color: #26343C !important;
    }


    /* =========================================================
       v3.29 - 선택지에서 직접 입력으로 전환한 상태
       전체 폭 흰 바를 없애고 채팅 위에 뜨는 입력 카드로 정리
    ========================================================= */

    html.${ACTIVE} [data-sentry-component="ChatComposer"]:has(
      button[aria-label="Back to choices"]
    ) {
      background: transparent !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatComposer"]
      > div:last-child:has(button[aria-label="Back to choices"]) {
      margin: 0 8px 8px !important;
      padding: 7px !important;
      width: auto !important;
      box-sizing: border-box !important;
      background: rgba(255,255,255,.88) !important;
      border: 1px solid rgba(69,87,97,.14) !important;
      border-radius: 16px !important;
      box-shadow: 0 4px 14px rgba(45,61,71,.14) !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatComposer"]
      button[aria-label="Back to choices"] {
      display: flex !important;
      background: #EEF1F3 !important;
      color: #53636C !important;
      border: 1px solid #E0E6E9 !important;
      border-radius: 999px !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatComposer"]
      button[aria-label="Back to choices"]:hover {
      background: #E4EAED !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatComposer"]
      button[aria-label="Back to choices"] svg {
      color: #53636C !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatComposer"]
      > div:last-child:has(button[aria-label="Back to choices"])
      .kt-composer-box {
      min-width: 0 !important;
      background: #F5F5F5 !important;
      border: 1px solid #E2E5E7 !important;
      box-shadow: inset 0 1px 2px rgba(0,0,0,.025) !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatComposer"]
      > div:last-child:has(button[aria-label="Back to choices"])
      textarea[aria-label="내용 입력하기"] {
      color: #26343C !important;
      line-height: 1.45 !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatComposer"]
      > div:last-child:has(button[aria-label="Back to choices"])
      button[aria-label="Insert asterisk"] svg {
      color: #687780 !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatComposer"]
      > div:last-child:has(button[aria-label="Back to choices"])
      [data-testid="chat-send-button"] {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      box-shadow: 0 1px 3px rgba(91,82,16,.14) !important;
    }

    html.${ACTIVE} [data-sentry-component="ChatComposer"]
      > div:last-child:has(button[aria-label="Back to choices"])
      [data-testid="chat-send-button"] svg {
      color: #191919 !important;
    }


    /* =========================================================
       v3.30 - 메시지 신고 및 오류제보 바텀시트
    ========================================================= */

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) > [role="presentation"] {
      background: rgba(43,57,66,.34) !important;
      backdrop-filter: blur(7px) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) > div[class*="rounded-t-"] {
      background: #FFFFFF !important;
      color: #26343C !important;
      border: 1px solid #DDE4E8 !important;
      border-bottom: 0 !important;
      box-shadow: 0 -10px 30px rgba(38,52,61,.18) !important;
    }

    /* 드래그 손잡이 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) > div[class*="rounded-t-"] > div:first-child svg {
      color: #9AA6AC !important;
    }

    /* 제목 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) span.heading1 {
      color: #202124 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) .body2 {
      color: #2E3B42 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) .caption1 {
      color: #7B888F !important;
    }

    /* 문제 선택 행 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) [role="button"]:has(> [role="checkbox"]) {
      margin: 0 -8px !important;
      padding-left: 8px !important;
      padding-right: 8px !important;
      border-bottom-color: #E8ECEE !important;
      border-radius: 8px !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) [role="button"]:has(> [role="checkbox"]):hover {
      background: #F7F9FA !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) [role="button"]:has(> [role="checkbox"])
      .body2 {
      color: #2E3B42 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) [role="button"]:has(> [role="checkbox"])
      .caption1 {
      color: #7B888F !important;
    }

    /* 체크박스 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) [role="checkbox"] {
      width: 20px !important;
      height: 20px !important;
      align-items: center !important;
      justify-content: center !important;
      border-radius: 5px !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) [role="checkbox"] svg {
      color: #8C989E !important;
      width: 18px !important;
      height: 18px !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) [role="checkbox"][aria-checked="true"] {
      background: var(--kt-yellow) !important;
      box-shadow: inset 0 0 0 1px #D7C200 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) [role="checkbox"][aria-checked="true"] svg {
      color: #332F18 !important;
    }

    /* 기타 직접 입력 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) label[data-sentry-component="Input"] {
      background: #F5F7F8 !important;
      color: #26343C !important;
      border: 1px solid #DCE3E7 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) label[data-sentry-component="Input"]:focus-within {
      background: #FFFFFF !important;
      border-color: #D2C24C !important;
      box-shadow: 0 0 0 3px rgba(254,229,0,.18) !important;
    }

    html.${ACTIVE} #portal-container
      input[name="message-report-description"] {
      background: transparent !important;
      color: #26343C !important;
      caret-color: #3D474C !important;
    }

    html.${ACTIVE} #portal-container
      input[name="message-report-description"]::placeholder {
      color: #929DA3 !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) button[type="submit"],
    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) button:last-of-type:not([role]) {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E4CF00 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        input[name="message-report-description"]
      ) button:disabled {
      background: #ECEFF1 !important;
      color: #A2AAAE !important;
      border-color: #E1E5E7 !important;
      opacity: 1 !important;
    }


    /* =========================================================
       v3.31 - 메시지 수정 화면
    ========================================================= */

    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"],
    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      > section {
      background: var(--kt-chat) !important;
      color: var(--kt-text) !important;
    }

    /* 본문 편집지 */
    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      > section > div:first-child {
      background: rgba(255,255,255,.97) !important;
      color: #26343C !important;
      border-color: rgba(69,87,97,.14) !important;
      box-shadow: 0 -6px 18px rgba(45,61,71,.12) !important;
    }

    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      button[aria-label="Resize edit area"] > div {
      background: #98A4AA !important;
    }

    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      textarea[name="message"] {
      background: transparent !important;
      color: #26343C !important;
      caret-color: #5C5425 !important;
      padding: 6px 16px 18px !important;
      line-height: 1.65 !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      textarea[name="message"]::placeholder {
      color: #929DA3 !important;
      opacity: 1 !important;
    }

    /* 하단 수정 도구 */
    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      > section > div:last-child {
      background: rgba(255,255,255,.97) !important;
      border-color: rgba(69,87,97,.14) !important;
      box-shadow: 0 -1px 5px rgba(45,61,71,.07) !important;
    }

    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      button[aria-label="Cancel editing"],
    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      button[aria-label="Insert asterisk"] {
      background: #E9EDF0 !important;
      color: #53636C !important;
      border: 1px solid #DDE4E8 !important;
    }

    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      button[aria-label="Cancel editing"]:hover,
    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      button[aria-label="Insert asterisk"]:hover {
      background: #DFE5E8 !important;
    }

    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      button[aria-label="Cancel editing"] svg,
    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      button[aria-label="Insert asterisk"] svg {
      color: #53636C !important;
    }

    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      button[aria-label="Save edit"] {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E2CB00 !important;
      box-shadow: 0 1px 3px rgba(91,82,16,.14) !important;
    }

    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      button[aria-label="Save edit"]:hover {
      background: var(--kt-yellow-hover) !important;
    }

    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      button[aria-label="Save edit"] svg {
      color: #191919 !important;
    }

    html.${ACTIVE} [data-sentry-component="EditModeInputPanelContent"]
      button[aria-label="Save edit"]:disabled {
      background: #E8EBED !important;
      color: #A2AAAE !important;
      border-color: #DDE2E5 !important;
      box-shadow: none !important;
    }


    /* =========================================================
       v3.32 - 맞춤 재생성 팝업
    ========================================================= */

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="InputMultiPlaceholder"]
      ) {
      background: rgba(43,57,66,.42) !important;
      backdrop-filter: blur(7px) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="InputMultiPlaceholder"]
      ) > div {
      background: #FFFFFF !important;
      color: #26343C !important;
      border: 1px solid #DDE4E8 !important;
      box-shadow: 0 18px 44px rgba(35,50,59,.22) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="InputMultiPlaceholder"]
      ) h5 {
      color: #202124 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="InputMultiPlaceholder"]
      ) > div > p {
      color: #66757D !important;
    }

    /* 요청 입력칸 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="InputMultiPlaceholder"]
      ) label[data-sentry-component="Input"] {
      background: #F5F7F8 !important;
      color: #26343C !important;
      border: 1px solid #DCE3E7 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="InputMultiPlaceholder"]
      ) label[data-sentry-component="Input"]:focus-within {
      background: #FFFFFF !important;
      border-color: #D2C24C !important;
      box-shadow: 0 0 0 3px rgba(254,229,0,.18) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="InputMultiPlaceholder"]
      ) input[data-sentry-component="Input"] {
      background: transparent !important;
      color: #26343C !important;
      caret-color: #3D474C !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]
      [data-sentry-component="InputMultiPlaceholder"] span {
      color: #929DA3 !important;
    }

    /* 취소 / 수정 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="InputMultiPlaceholder"]
      ) > div > div:last-child > button:first-child {
      background: #ECEFF1 !important;
      color: #46545E !important;
      border: 1px solid #E0E5E8 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="InputMultiPlaceholder"]
      ) > div > div:last-child > button:first-child:hover {
      background: #E3E8EB !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="InputMultiPlaceholder"]
      ) > div > div:last-child > button:last-child {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E2CB00 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="InputMultiPlaceholder"]
      ) > div > div:last-child > button:last-child:hover {
      background: var(--kt-yellow-hover) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="InputMultiPlaceholder"]
      ) > div > div:last-child > button:last-child:disabled {
      background: #ECEFF1 !important;
      color: #A2AAAE !important;
      border-color: #E1E5E7 !important;
      opacity: 1 !important;
    }


    /* =========================================================
       v3.33 - 상단 현재 AI 모델 버튼 최종 우선순위 보정
    ========================================================= */

    html.${ACTIVE} main#contents
      button[data-testid="chat-header-model"][aria-label="Select AI model"] {
      min-height: 30px !important;
      padding: 6px 10px 6px 12px !important;
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #DFC900 !important;
      border-radius: 999px !important;
      box-shadow: 0 1px 3px rgba(91,82,16,.15) !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} main#contents
      button[data-testid="chat-header-model"][aria-label="Select AI model"]:hover {
      background: var(--kt-yellow-hover) !important;
      border-color: #CDB900 !important;
    }

    html.${ACTIVE} main#contents
      button[data-testid="chat-header-model"][aria-label="Select AI model"] img {
      filter: brightness(0) saturate(100%) !important;
      opacity: .82 !important;
    }

    html.${ACTIVE} main#contents
      button[data-testid="chat-header-model"][aria-label="Select AI model"] svg {
      color: #4B451E !important;
      opacity: 1 !important;
    }


    /* =========================================================
       v3.35 - 대화 프로필 추가 버튼 / 새 대화 프로필 생성 페이지
    ========================================================= */

    /* 현재 DOM은 '대화 프로필 추가'가 첫 번째 섹션의 직접 버튼이다.
       예전 > div:nth-child(2) 규칙은 더 이상 매칭되지 않아 최종 구조로 보정. */
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      > div:first-child > button[data-sentry-component="LogRawButton"]:first-of-type {
      background: #F4F6F7 !important;
      color: #26343C !important;
      border: 1px solid #E4E9EC !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      > div:first-child > button[data-sentry-component="LogRawButton"]:first-of-type:hover,
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      > div:first-child > button[data-sentry-component="LogRawButton"]:first-of-type:active {
      background: #EEF2F4 !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      > div:first-child > button[data-sentry-component="LogRawButton"]:first-of-type
      > div:first-child {
      background: #E8EDF0 !important;
      color: #50616B !important;
    }

    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      > div:first-child > button[data-sentry-component="LogRawButton"]:first-of-type
      > span,
    html.${ACTIVE} #portal-container
      section[role="dialog"][aria-label="대화 프로필"]
      > div:first-child > button[data-sentry-component="LogRawButton"]:first-of-type
      svg {
      color: #50616B !important;
      opacity: 1 !important;
      visibility: visible !important;
    }

    /* 새 대화 프로필 페이지 본체 */
    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileCreatePage"],
    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileCreatePage"]
      [data-sentry-component="ChatProfileForm"],
    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileCreatePage"] form {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
    }

    /* 상단 프로필 미리보기 */
    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileCreatePage"]
      [data-sentry-source-file="ChatProfilePreview.tsx"] .title18 {
      color: #202124 !important;
      opacity: 1 !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileCreatePage"]
      [data-sentry-source-file="ChatProfilePreview.tsx"]
      div.absolute.right-0.bottom-0 {
      background: var(--kt-yellow) !important;
      color: #3B3514 !important;
      border: 2px solid #FFFFFF !important;
      box-shadow: 0 1px 3px rgba(0,0,0,.12) !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileCreatePage"]
      [data-sentry-source-file="ChatProfilePreview.tsx"]
      div.absolute.right-0.bottom-0 svg {
      color: #3B3514 !important;
    }

    /* 섹션 라벨 / 보조문구 */
    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileCreatePage"]
      [data-sentry-component="EditFormSectionContainer"]
      [class*="text-white/50"] {
      color: #858F94 !important;
      opacity: 1 !important;
    }

    /* 기본 대화 프로필 카드 */
    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileCreatePage"]
      [data-sentry-component="EditFormSectionContainer"]
      > div[data-sentry-source-file="ChatProfileSetDefaultField.tsx"] {
      background: #F5F7F8 !important;
      color: #26343C !important;
      border: 1px solid #E3E8EB !important;
      box-shadow: none !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileCreatePage"]
      [data-sentry-source-file="ChatProfileSetDefaultField.tsx"] .body14 {
      color: #26343C !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileCreatePage"]
      [data-sentry-source-file="ChatProfileSetDefaultField.tsx"] .body12 {
      color: #7B888F !important;
    }

    /* 토글 OFF / ON */
    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileCreatePage"]
      [data-sentry-source-file="ChatProfileSetDefaultField.tsx"]
      button > div[class*="h-5"][class*="w-9"] {
      background: #CDD4D8 !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileCreatePage"]
      [data-sentry-source-file="ChatProfileSetDefaultField.tsx"]
      button > div[class*="bg-primary-"] {
      background: var(--kt-yellow) !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileCreatePage"]
      [data-sentry-source-file="ChatProfileSetDefaultField.tsx"]
      button > div > div {
      background: #FFFFFF !important;
      box-shadow: 0 1px 3px rgba(45,55,61,.20) !important;
    }

    /* 하단 추가하기 버튼 */
    html.kt-profile-edit-active:has(
      [data-sentry-component="ChatProfileCreatePage"]
    ) #portal-container
      > div[class*="bottom-0"][class*="absolute"]
      > button[data-sentry-component="Button"] {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #E4CF00 !important;
      box-shadow: 0 2px 5px rgba(91,82,16,.12) !important;
      opacity: 1 !important;
    }

    html.kt-profile-edit-active:has(
      [data-sentry-component="ChatProfileCreatePage"]
    ) #portal-container
      > div[class*="bottom-0"][class*="absolute"]
      > button[data-sentry-component="Button"]:hover:not(:disabled) {
      background: var(--kt-yellow-hover) !important;
    }

    html.kt-profile-edit-active:has(
      [data-sentry-component="ChatProfileCreatePage"]
    ) #portal-container
      > div[class*="bottom-0"][class*="absolute"]
      > button[data-sentry-component="Button"]:disabled {
      background: #E8EBED !important;
      color: #A2AAAE !important;
      border-color: #DDE2E5 !important;
      box-shadow: none !important;
      opacity: 1 !important;
    }


    /* =========================================================
       v3.36 - 제타그램: Instagram light UI
       기능/DOM은 유지하고 시각만 인스타그램 웹/앱 느낌으로 변경
    ========================================================= */

    /* 바깥 딤 */
    html.${ACTIVE} #portal-container
      [data-testid="zetagram-backdrop"] {
      background: rgba(0,0,0,.48) !important;
      backdrop-filter: blur(1.5px) !important;
    }

    /* 제타그램 본체 */
    html.${ACTIVE} #portal-container
      [data-testid="zetagram-panel"]
      div:has(> header[data-sentry-component="TopBar"]):has(> [data-testid="zetagram-feed"]) {
      background: #FFFFFF !important;
      color: #262626 !important;
      color-scheme: light !important;
      border: 1px solid #DBDBDB !important;
      border-radius: 14px !important;
      box-shadow: 0 18px 50px rgba(0,0,0,.24) !important;
    }

    /* 상단 Instagram식 흰 헤더 */
    html.${ACTIVE} #portal-container
      [data-testid="zetagram-panel"]
      header[data-sentry-component="TopBar"] {
      min-height: 50px !important;
      padding: 8px 12px 7px 14px !important;
      background: #FFFFFF !important;
      color: #000000 !important;
      border-bottom: 1px solid #DBDBDB !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-panel"]
      [data-sentry-component="ZetagramWordmark"] {
      height: 30px !important;
      color: #000000 !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-panel"]
      header[data-sentry-component="TopBar"] button[aria-label="닫기"] {
      background: transparent !important;
      color: #262626 !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-panel"]
      header[data-sentry-component="TopBar"] button[aria-label="닫기"]:hover {
      background: #F2F2F2 !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-panel"]
      header[data-sentry-component="TopBar"] button[aria-label="닫기"] svg {
      color: #262626 !important;
    }

    /* 피드 */
    html.${ACTIVE} #portal-container
      [data-testid="zetagram-feed"] {
      background: #FFFFFF !important;
      color: #262626 !important;
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-feed"]::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-feed"] > div.h-px {
      background: #FFFFFF !important;
    }

    /* 당겨서 새로고침 */
    html.${ACTIVE} #portal-container
      [data-testid="zetagram-feed"]
      [data-sentry-component="PullToRefreshIndicator"] {
      background: #FAFAFA !important;
      color: #737373 !important;
      border-bottom: 1px solid #EFEFEF !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-feed"]
      [data-sentry-component="PullToRefreshIndicator"] > span:first-child {
      border-color: #D8D8D8 !important;
      border-top-color: #0095F6 !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-feed"]
      [data-sentry-component="PullToRefreshIndicator"] > span:last-child {
      color: #737373 !important;
    }

    /* 게시물 없음 */
    html.${ACTIVE} #portal-container
      [data-testid="zetagram-feed"]
      > div:has(> svg[data-sentry-component="CameraIcon"]) {
      background: #FFFFFF !important;
      color: #262626 !important;
      padding-top: 62px !important;
      padding-bottom: 62px !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-feed"]
      > div:has(> svg[data-sentry-component="CameraIcon"])
      svg {
      width: 46px !important;
      height: 46px !important;
      color: #262626 !important;
      border: 2px solid #262626 !important;
      border-radius: 999px !important;
      padding: 8px !important;
      box-sizing: content-box !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-feed"]
      > div:has(> svg[data-sentry-component="CameraIcon"])
      p:first-of-type {
      margin-top: 8px !important;
      color: #262626 !important;
      font-size: 16px !important;
      line-height: 20px !important;
      font-weight: 600 !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-feed"]
      > div:has(> svg[data-sentry-component="CameraIcon"])
      p:last-of-type {
      max-width: 280px !important;
      color: #737373 !important;
      font-size: 13px !important;
      line-height: 18px !important;
    }

    /* 게시물 카드 */
    html.${ACTIVE} #portal-container
      [data-testid="zetagram-feed"]
      [data-sentry-component="PostCard"] {
      padding-bottom: 14px !important;
      background: #FFFFFF !important;
      color: #262626 !important;
      border-bottom: 1px solid #DBDBDB !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"] > header {
      padding: 10px 12px !important;
      background: #FFFFFF !important;
    }

    /* 스토리 링은 Instagram gradient 유지, 안쪽은 흰색 */
    html.${ACTIVE} #portal-container
      [data-testid="zetagram-story-ring"] > span {
      background: #FFFFFF !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-story-ring"] > span > span {
      background: #EFEFEF !important;
    }

    /* 아이디/표시명 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"] > header
      > div > span:first-child {
      color: #262626 !important;
      font-weight: 600 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"] > header
      > div > span:last-child {
      color: #737373 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"]
      button[aria-label="게시물 메뉴"],
    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"]
      button[aria-label="게시물 메뉴"] svg {
      color: #262626 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"]
      button[aria-label="게시물 메뉴"]:hover {
      background: #F5F5F5 !important;
      border-radius: 999px !important;
    }

    /* 사진 영역 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"]
      [data-sentry-component="Square"] {
      background: #EFEFEF !important;
    }

    /* 좋아요/댓글/공유 아이콘 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"] > div:nth-of-type(2) {
      padding: 9px 12px 7px !important;
      gap: 16px !important;
      background: #FFFFFF !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"]
      [data-sentry-component="HeartIcon"],
    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"]
      [data-sentry-component="CommentIcon"],
    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"]
      [data-sentry-component="ShareIcon"],
    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"]
      [data-sentry-component="ShareSheetIcon"] {
      color: #262626 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"]
      button[aria-label="좋아요"]:hover svg,
    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"]
      button[aria-label="게시물 공유"]:hover svg {
      color: #737373 !important;
    }

    /* 좋아요/캡션/댓글 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"] > div:last-of-type {
      padding-left: 12px !important;
      padding-right: 12px !important;
      gap: 5px !important;
      color: #262626 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"]
      [class*="text-[#F8F9F9]"] {
      color: #262626 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="PostCard"]
      [class*="text-[#B79BFF]"] {
      color: #00376B !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="PostComments"] {
      color: #262626 !important;
      gap: 4px !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="PostComments"] li.pl-7 {
      padding-left: 18px !important;
      border-left: 2px solid #EFEFEF !important;
      margin-left: 4px !important;
    }

    /* 게시물 메뉴: Instagram 흰 액션 모달 */
    html.${ACTIVE} #portal-container
      [data-testid="zetagram-post-sheet"] > div[aria-hidden="true"] {
      background: rgba(0,0,0,.42) !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-post-sheet"]
      [role="dialog"][aria-label="게시물 메뉴"] {
      width: 270px !important;
      background: #FFFFFF !important;
      color: #262626 !important;
      border: 1px solid #DBDBDB !important;
      border-radius: 12px !important;
      box-shadow: 0 12px 35px rgba(0,0,0,.20) !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-post-sheet"]
      [role="dialog"][aria-label="게시물 메뉴"] button {
      min-height: 48px !important;
      background: #FFFFFF !important;
      border-color: #DBDBDB !important;
      color: #262626 !important;
      font-weight: 400 !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-post-sheet"]
      [role="dialog"][aria-label="게시물 메뉴"] button:first-child,
    html.${ACTIVE} #portal-container
      [data-testid="zetagram-post-sheet"]
      [role="dialog"][aria-label="게시물 메뉴"] button:first-child span {
      color: #ED4956 !important;
      font-weight: 700 !important;
    }

    html.${ACTIVE} #portal-container
      [data-testid="zetagram-post-sheet"]
      [role="dialog"][aria-label="게시물 메뉴"] button:hover {
      background: #FAFAFA !important;
    }

    /* 새로고침 확인 팝업 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="RefreshConfirmContent"]
      ) {
      background: rgba(0,0,0,.48) !important;
      backdrop-filter: blur(1.5px) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="RefreshConfirmContent"]
      ) > div {
      width: 340px !important;
      background: #FFFFFF !important;
      color: #262626 !important;
      border: 1px solid #DBDBDB !important;
      border-radius: 14px !important;
      box-shadow: 0 16px 38px rgba(0,0,0,.22) !important;
      padding: 28px 20px 18px !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="RefreshConfirmContent"]
      .title16 {
      color: #262626 !important;
      font-size: 16px !important;
      line-height: 21px !important;
      font-weight: 600 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="RefreshConfirmContent"] p {
      color: #737373 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="RefreshConfirmContent"]
      [data-sentry-component="CheckBox"],
    html.${ACTIVE} #portal-container
      [data-sentry-component="RefreshConfirmContent"]
      [data-sentry-component="CheckBox"] span {
      color: #262626 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="RefreshConfirmContent"]
      [data-sentry-component="CheckBox"] svg {
      color: #A8A8A8 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="RefreshConfirmContent"]
      ) > div > div:last-child {
      gap: 8px !important;
      margin-top: 22px !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="RefreshConfirmContent"]
      ) > div > div:last-child > button:first-child {
      background: #FFFFFF !important;
      color: #262626 !important;
      border: 1px solid #DBDBDB !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="RefreshConfirmContent"]
      ) > div > div:last-child > button:first-child:hover {
      background: #FAFAFA !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="RefreshConfirmContent"]
      ) > div > div:last-child > button:last-child {
      background: #0095F6 !important;
      color: #FFFFFF !important;
      border: 1px solid #0095F6 !important;
      box-shadow: none !important;
      font-weight: 600 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [data-sentry-component="RefreshConfirmContent"]
      ) > div > div:last-child > button:last-child:hover {
      background: #1877F2 !important;
      border-color: #1877F2 !important;
    }

    /* Zetagram 토스트도 Instagram식 */
    html.${ACTIVE}:has([data-testid="zetagram-panel"]) #portal-container
      [data-sentry-source-file="ToastItem.tsx"][role="presentation"] {
      background: #262626 !important;
      color: #FFFFFF !important;
      border-radius: 8px !important;
      box-shadow: 0 4px 16px rgba(0,0,0,.18) !important;
    }

    html.${ACTIVE}:has([data-testid="zetagram-panel"]) #portal-container
      [data-sentry-source-file="ToastItem.tsx"][role="presentation"] span {
      color: #FFFFFF !important;
    }


    /* =========================================================
       v3.37 - 프로필 선택 카드 가독성 보정
       흰 카드 위에 남아 있던 Zeta 다크용 text-white 계열 제거
    ========================================================= */

    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] {
      color: #26343C !important;
    }

    /* 카드의 주 텍스트 */
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] h1,
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] h2,
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] h3,
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] h4,
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] h5,
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] strong,
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] .body1,
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] .body14,
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] .body16,
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] [class*="text-white"]:not(button):not(svg) {
      color: #26343C !important;
      opacity: 1 !important;
    }

    /* 카드 설명 / 메타데이터 */
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] .caption1,
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] .caption2,
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] .body12,
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] [class*="text-gray-"],
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] [class*="opacity-"] {
      color: #63737C !important;
      opacity: 1 !important;
    }

    /* 선택 버튼 안 글씨는 기존 카카오 노랑 버튼 색 유지 */
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] .kt-profile-select-button,
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"] .kt-profile-select-button span {
      color: #191919 !important;
      opacity: 1 !important;
    }

    /* 수정 아이콘 */
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"]
      button[aria-label="Edit chat profile"],
    html.${ACTIVE} [data-sentry-component="PlotProfileCard"]
      button[aria-label="Edit chat profile"] svg {
      color: #53636C !important;
      opacity: 1 !important;
    }


    /* =========================================================
       v3.38 - 익명 게시판: 흰색 커뮤니티 UI
       카톡 느낌이 아니라 일반 커뮤니티/게시판 계열의
       white + gray + muted navy 톤
    ========================================================= */

    /* ---------- 게시판 전체 ---------- */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"],
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardPanel"],
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="anonymous-board-safe-area"] {
      background: #FFFFFF !important;
      color: #20242A !important;
      color-scheme: light !important;
    }

    /* 다크 테마 잔재 공통 제거 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardPanel"] .text-white {
      color: #20242A !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardPanel"] [class*="text-white/"] {
      color: #7B858F !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardPanel"] [class*="border-white/"] {
      border-color: #E6E9ED !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardPanel"] [class*="bg-white/10"],
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardPanel"] [class*="bg-white/15"] {
      background: #F1F3F5 !important;
    }

    /* ---------- 상단 헤더 ---------- */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      header[data-sentry-component="Header"] {
      background: #FFFFFF !important;
      color: #20242A !important;
      border-bottom: 1px solid #E6E9ED !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      header[data-sentry-component="Header"] h2 {
      color: #20242A !important;
      font-weight: 700 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      header[data-sentry-component="Header"]
      button[aria-label="닫기"],
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      header[data-sentry-component="Header"]
      button[aria-label="뒤로"] {
      color: #303841 !important;
      background: transparent !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      header[data-sentry-component="Header"]
      button[aria-label="닫기"] svg,
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      header[data-sentry-component="Header"]
      button[aria-label="뒤로"] svg {
      color: #303841 !important;
    }

    /* 글쓰기 헤더: 취소 / 등록 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      header[data-sentry-component="Header"] nav
      > button:first-child:not([aria-label]) {
      color: #6F7882 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      header[data-sentry-component="Header"] nav
      > button:last-child:not([aria-label]) {
      color: #355E7A !important;
      font-weight: 700 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      header[data-sentry-component="Header"] nav
      > button:last-child:not([aria-label]):disabled {
      color: #B9C0C7 !important;
    }

    /* ---------- 탭 ---------- */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardTabs"] {
      background: #FFFFFF !important;
      border-bottom: 1px solid #E6E9ED !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardTabs"]
      [role="tab"] {
      color: #8A939C !important;
      background: transparent !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardTabs"]
      [role="tab"][aria-selected="true"] {
      color: #263746 !important;
      font-weight: 700 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardTabs"]
      [role="tab"][aria-selected="true"]
      > span:last-child {
      background: #486A84 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-tab-unread-dot"],
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-post-unread-dot"] {
      background: #EF5350 !important;
      box-shadow: none !important;
    }

    /* 새 글 불러오기 10피스 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardTabs"]
      button[aria-label^="새 글 불러오기"] {
      background: #FFFFFF !important;
      color: #66727D !important;
      border: 1px solid #DDE2E7 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardTabs"]
      button[aria-label^="새 글 불러오기"]:hover {
      background: #F7F8FA !important;
      border-color: #CDD4DA !important;
    }

    /* ---------- 목록 / 스크롤 ---------- */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardList"],
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-scroll"],
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-pull-content"] {
      background: #FFFFFF !important;
      color: #20242A !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-scroll"] {
      scrollbar-width: thin !important;
      scrollbar-color: #CDD3D9 transparent !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-scroll"]::-webkit-scrollbar {
      width: 5px !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-scroll"]::-webkit-scrollbar-thumb {
      background: #CDD3D9 !important;
      border-radius: 999px !important;
    }

    /* 당겨서 새 글 보기 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-pull-indicator"] {
      background: #F7F8FA !important;
      color: #7A848E !important;
      border-bottom: 1px solid #ECEFF2 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-pull-spinner"] {
      border-color: #D8DDE2 !important;
      border-top-color: #486A84 !important;
    }

    /* ---------- 빈 게시판 ---------- */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="EmptyBoard"] {
      background: #FFFFFF !important;
      color: #20242A !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="EmptyBoard"] p:first-of-type {
      color: #39424C !important;
      font-weight: 700 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="EmptyBoard"] p:last-of-type {
      color: #8A949E !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="EmptyBoard"] button {
      background: #486A84 !important;
      color: #FFFFFF !important;
      border: 1px solid #486A84 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="EmptyBoard"] button:hover {
      background: #3E5E75 !important;
      border-color: #3E5E75 !important;
    }

    /* ---------- 글 목록 카드 ---------- */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardList"]
      [data-sentry-component="PostCard"] {
      background: #FFFFFF !important;
      color: #20242A !important;
      border-bottom: 1px solid #ECEFF2 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardList"]
      [data-sentry-component="PostCard"]:hover {
      background: #FAFBFC !important;
    }

    /* 익명 아바타 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="AnonymousAvatar"] {
      background: #EEF1F4 !important;
      color: #89939D !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="AnonymousAvatar"] svg {
      color: #89939D !important;
    }

    /* 작성자 / 시간 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PostCard"]
      > button > div:first-child
      > span:nth-child(2) {
      color: #65717C !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PostCard"]
      > button > div:first-child
      > span[class*="ml-auto"] {
      color: #A0A7AE !important;
    }

    /* 내가 쓴 글의 작성자 강조색 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PostCard"]
      [class*="text-primary-"] {
      color: #355E7A !important;
    }

    /* 제목 / 미리보기 본문 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PostCard"]
      > button > span[class*="font-semibold"] {
      color: #20242A !important;
      font-weight: 700 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PostCard"]
      > button > p {
      color: #6F7983 !important;
    }

    /* 좋아요 / 댓글 수 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PostStats"],
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PostStats"]
      [data-sentry-component="Stat"] {
      color: #8A949D !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PostStats"] svg {
      color: #8A949D !important;
    }

    /* ---------- 투표 ---------- */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PollOptions"] > button,
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PollOptions"] > div {
      background: #FFFFFF !important;
      color: #303840 !important;
      border-color: #DDE2E7 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PollOptions"] > button:hover {
      background: #F7F9FB !important;
      border-color: #C9D2D9 !important;
    }

    /* 결과 게이지 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PollOptions"]
      span[class*="bg-primary-"] {
      background: #E8F0F5 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PollOptions"]
      > div[class*="border-primary-"] {
      border-color: #5B7A91 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PollOptions"]
      span[class*="text-primary-"] {
      color: #355E7A !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PollOptions"]
      + div > span:first-child {
      color: #9099A2 !important;
    }

    /* ---------- 글쓰기 플로팅 버튼 ---------- */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="글쓰기"] {
      background: #486A84 !important;
      color: #FFFFFF !important;
      border: 1px solid #486A84 !important;
      box-shadow: 0 5px 16px rgba(44,69,87,.22) !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="글쓰기"]:hover {
      background: #3E5E75 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="글쓰기"] svg {
      color: #FFFFFF !important;
    }

    /* ---------- 게시글 상세 ---------- */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-post-block"] {
      background: #FFFFFF !important;
      color: #20242A !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-post-block"] h3 {
      color: #20242A !important;
      font-weight: 700 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-post-block"] > p {
      color: #3F4851 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-post-block"]
      > div:first-child > span:nth-child(2) {
      color: #65717C !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-post-block"]
      > div:first-child > span[class*="ml-auto"] {
      color: #A0A7AE !important;
    }

    /* 글 / 댓글 사이 구분띠 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-post-block"] + div {
      background: #F4F6F8 !important;
      border-top: 1px solid #ECEFF2 !important;
      border-bottom: 1px solid #ECEFF2 !important;
    }

    /* ---------- 댓글 ---------- */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-comments-block"] {
      background: #FFFFFF !important;
      color: #20242A !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-comments-block"] > p:first-child {
      color: #313A43 !important;
      font-weight: 700 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="CommentList"] > li {
      background: #FFFFFF !important;
      border-bottom: 1px solid #EEF1F3 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="CommentList"]
      > li > div > div:first-child {
      color: #929BA4 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="CommentList"]
      > li > div > div:first-child > span:first-child {
      color: #56636E !important;
      font-weight: 700 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="CommentList"]
      > li > div > div:first-child button {
      color: #7A8791 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="CommentList"]
      > li > div > p {
      color: #343D45 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="CommentList"]
      [class*="text-primary-"] {
      color: #355E7A !important;
    }

    /* 상세 하단 입력 바 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardPanel"]
      > [data-testid="anonymous-board-safe-area"]
      > div:last-of-type {
      border-top-color: #E5E9ED !important;
      background: #FFFFFF !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"] {
      color: #77838D !important;
      background: transparent !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"][aria-pressed="true"] {
      color: #E0525C !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"] svg {
      color: currentColor !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="CommentComposer"] {
      background: #F1F3F5 !important;
      border: 1px solid #E1E5E8 !important;
      color: #20242A !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="CommentComposer"]
      textarea {
      color: #28313A !important;
      caret-color: #486A84 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="CommentComposer"]
      textarea::placeholder {
      color: #9AA2AA !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="CommentComposer"]
      button[aria-label="등록"] {
      color: #486A84 !important;
      background: transparent !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="CommentComposer"]
      button[aria-label="등록"] svg {
      color: #486A84 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="CommentComposer"]
      button[aria-label="등록"]:disabled svg {
      color: #B8C0C7 !important;
    }

    /* ---------- 글쓰기 ---------- */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      input[aria-label="제목"],
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      textarea[aria-label="내용을 입력하세요"] {
      background: #FFFFFF !important;
      color: #20242A !important;
      border-color: #E5E9ED !important;
      caret-color: #486A84 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      input[aria-label="제목"]::placeholder,
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      textarea[aria-label="내용을 입력하세요"]::placeholder {
      color: #A0A8B0 !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      textarea[aria-label="내용을 입력하세요"] + span {
      color: #9AA2AA !important;
    }

    /* 작성자 선택 영역 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      div:has(> [role="radiogroup"][aria-label="작성자"]) {
      border-top-color: #E5E9ED !important;
      background: #FFFFFF !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      div:has(> [role="radiogroup"][aria-label="작성자"])
      > span:first-child {
      color: #7D8790 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [role="radiogroup"][aria-label="작성자"]
      button[role="radio"] {
      border: 1px solid #DDE2E6 !important;
      background: #F2F4F6 !important;
      color: #626E78 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [role="radiogroup"][aria-label="작성자"]
      button[role="radio"][aria-checked="true"] {
      background: #486A84 !important;
      color: #FFFFFF !important;
      border-color: #486A84 !important;
    }

    /* 이름 지정 시 나타나는 추가 입력칸도 흰 커뮤 톤 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardPanel"]
      input:not([aria-label="제목"]) {
      background: #FFFFFF !important;
      color: #20242A !important;
      border-color: #DDE2E7 !important;
      caret-color: #486A84 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardPanel"]
      input:not([aria-label="제목"])::placeholder {
      color: #A0A8B0 !important;
    }

    /* ---------- 10피스 새 글 확인 팝업 ---------- */
    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [aria-label="이번 게시판에서는 다시 묻지 않기"]
      ) {
      background: rgba(25,31,36,.38) !important;
      backdrop-filter: blur(1.5px) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [aria-label="이번 게시판에서는 다시 묻지 않기"]
      )
      > div[class*="absolute"] {
      background: #FFFFFF !important;
      color: #20242A !important;
      border: 1px solid #E1E5E9 !important;
      border-radius: 12px !important;
      box-shadow: 0 14px 38px rgba(28,38,46,.18) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="PurchasePopupContent"]
      .title16 {
      color: #20242A !important;
      font-weight: 700 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="PurchasePopupContent"]
      p {
      color: #7A858F !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="PurchasePopupContent"]
      [data-sentry-component="CheckBox"] span {
      color: #4F5A64 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="PurchasePopupContent"]
      [data-sentry-component="CheckBox"] svg {
      color: #8B969F !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [aria-label="이번 게시판에서는 다시 묻지 않기"]
      )
      > div[class*="absolute"] > div:last-child
      > button:first-child {
      background: #F1F3F5 !important;
      color: #4E5963 !important;
      border: 1px solid #E1E5E9 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [aria-label="이번 게시판에서는 다시 묻지 않기"]
      )
      > div[class*="absolute"] > div:last-child
      > button:last-child {
      background: #486A84 !important;
      color: #FFFFFF !important;
      border: 1px solid #486A84 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="Popup"]:has(
        [aria-label="이번 게시판에서는 다시 묻지 않기"]
      )
      > div[class*="absolute"] > div:last-child
      > button:last-child:hover {
      background: #3E5E75 !important;
    }


    /* =========================================================
       v3.39 - 익명 게시판 공감 하트 상태 복구
       false = 회색 빈 하트 / true = 빨간 꽉 찬 하트
    ========================================================= */

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"] {
      appearance: none !important;
      -webkit-appearance: none !important;
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
      cursor: pointer !important;
      pointer-events: auto !important;
      color: #7B8791 !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"][aria-pressed="false"],
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"][aria-pressed="false"] svg {
      color: #7B8791 !important;
      fill: none !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"][aria-pressed="false"] svg path {
      fill: none !important;
      stroke: currentColor !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"][aria-pressed="true"],
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"][aria-pressed="true"] svg {
      color: #F04452 !important;
      fill: #F04452 !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"][aria-pressed="true"] svg path {
      color: #F04452 !important;
      fill: currentColor !important;
      stroke: none !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"]:hover {
      color: #5F6B75 !important;
      background: #F3F5F7 !important;
      border-radius: 999px !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"][aria-pressed="true"]:hover {
      color: #E73545 !important;
      background: #FFF1F3 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"]:active {
      transform: scale(.90) !important;
    }


    /* =========================================================
       v3.40 - 익명 게시판: 내가 쓴 글 배경 강조
       작성자명에 Zeta의 primary 색이 붙는 내 글만 연회색 처리
    ========================================================= */

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardList"]
      [data-sentry-component="PostCard"]:has(
        > button > div:first-child > .caption1[class*="text-primary-"]
      ) {
      background: #F5F6F7 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardList"]
      [data-sentry-component="PostCard"]:has(
        > button > div:first-child > .caption1[class*="text-primary-"]
      ):hover {
      background: #EEF1F3 !important;
    }

    /* 내 글 작성자명도 배경 위에서 조금 더 선명하게 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="BoardList"]
      [data-sentry-component="PostCard"]
      > button > div:first-child > .caption1[class*="text-primary-"] {
      color: #355E7A !important;
      font-weight: 700 !important;
    }


    /* =========================================================
       v3.41 - 익명 게시판 공감 버튼 재수정
       제타 원본이 SVG path를 교체하는 방식을 그대로 보존.
       테마는 색/클릭영역만 담당한다.
    ========================================================= */

    /* 하단 공감+댓글 바 자체를 클릭 가능한 최상단 레이어로 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      div:has(> button[aria-label="공감"]):has(
        [data-sentry-component="CommentComposer"]
      ) {
      position: relative !important;
      z-index: 20 !important;
      background: #FFFFFF !important;
    }

    /* 공감 버튼 클릭 영역 보장 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"] {
      position: relative !important;
      z-index: 3 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex: 0 0 36px !important;
      width: 36px !important;
      height: 36px !important;
      padding: 6px !important;
      margin: 0 !important;
      appearance: auto !important;
      -webkit-appearance: auto !important;
      pointer-events: auto !important;
      touch-action: manipulation !important;
      cursor: pointer !important;
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
      opacity: 1 !important;
      transform: none !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"] svg {
      position: relative !important;
      z-index: 1 !important;
      width: 20px !important;
      height: 20px !important;
      pointer-events: none !important;
      opacity: 1 !important;
    }

    /*
      중요:
      이전 v3.39의 aria-pressed 기준 fill/stroke 강제값을
      실제 SVG path 속성 기준으로 다시 덮는다.
      - 빈 하트 path: fill 속성 없음 + stroke 속성 있음
      - 채운 하트 path: fill="currentColor"
    */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"] svg path[stroke] {
      fill: none !important;
      stroke: currentColor !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"] svg path[fill="currentColor"] {
      fill: currentColor !important;
      stroke: none !important;
    }

    /* 기본: 회색 빈 하트 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"] {
      color: #7B8791 !important;
    }

    /* 제타가 눌림 상태로 바꾼 모든 신호를 인정 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"][aria-pressed="true"],
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"].text-error-light,
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"]:has(svg path[fill="currentColor"]) {
      color: #F04452 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"]:hover {
      background: #F3F5F7 !important;
      border-radius: 999px !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"][aria-pressed="true"]:hover,
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"].text-error-light:hover,
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      button[aria-label="공감"]:has(svg path[fill="currentColor"]):hover {
      background: #FFF1F3 !important;
      color: #E73545 !important;
    }

    /* 댓글 입력 폼이 하트 위를 덮지 않도록 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="CommentComposer"] {
      position: relative !important;
      z-index: 1 !important;
    }


    /* =========================================================
       v3.42 - 익명 게시판 공감 표시/클릭 보정
       PostStats의 "내가 공감함" 상태는 반드시 빨간 하트.
       상세 화면의 통계 하트도 실제 하단 공감 버튼으로 연결.
    ========================================================= */

    /* 일반 통계 하트 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PostStats"]
      [data-sentry-component="Stat"][aria-label^="공감"] {
      color: #8A949D !important;
      opacity: 1 !important;
    }

    /* 공감 완료 상태: 기존 회색 !important보다 뒤에서 강제 우선 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PostStats"]
      [data-sentry-component="Stat"][aria-label*="내가 공감함"] {
      color: #F04452 !important;
      font-weight: 700 !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PostStats"]
      [data-sentry-component="Stat"][aria-label*="내가 공감함"] svg {
      color: #F04452 !important;
      fill: none !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-sentry-component="PostStats"]
      [data-sentry-component="Stat"][aria-label*="내가 공감함"] svg path[fill="currentColor"] {
      color: #F04452 !important;
      fill: currentColor !important;
      stroke: none !important;
    }

    /* 상세 페이지의 상단 공감 통계도 클릭 가능한 것처럼 표시 */
    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-post-block"]
      [data-sentry-component="PostStats"]
      [data-sentry-component="Stat"][aria-label^="공감"] {
      cursor: pointer !important;
      user-select: none !important;
      border-radius: 6px !important;
      padding: 3px 5px !important;
      margin: -3px -5px !important;
      transition: background-color .12s ease, color .12s ease !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-post-block"]
      [data-sentry-component="PostStats"]
      [data-sentry-component="Stat"][aria-label^="공감"]:hover {
      background: #F2F4F6 !important;
    }

    html.${ACTIVE} #portal-container
      [role="dialog"][aria-label="익명 게시판"]
      [data-testid="board-post-block"]
      [data-sentry-component="PostStats"]
      [data-sentry-component="Stat"][aria-label*="내가 공감함"]:hover {
      background: #FFF0F2 !important;
    }


    /* =========================================================
       v3.43 - 신형 대화 프로필 편집 페이지
       /chat-profile/edit/...
    ========================================================= */

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileForm"],
    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileForm"] form {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileForm"]
      [data-sentry-source-file="ChatProfilePreview.tsx"] .title18 {
      color: #202124 !important;
      opacity: 1 !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileForm"]
      [data-sentry-source-file="ChatProfilePreview.tsx"]
      div.absolute.right-0.bottom-0 {
      background: var(--kt-yellow) !important;
      color: #3B3514 !important;
      border: 2px solid #FFFFFF !important;
      box-shadow: 0 1px 3px rgba(0,0,0,.12) !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileForm"]
      [data-sentry-source-file="ChatProfilePreview.tsx"]
      div.absolute.right-0.bottom-0 svg {
      color: #3B3514 !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileForm"]
      [data-sentry-source-file="ChatProfileSetDefaultField.tsx"] {
      background: #F5F7F8 !important;
      color: #26343C !important;
      border: 1px solid #E3E8EB !important;
      box-shadow: none !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileForm"]
      [data-sentry-source-file="ChatProfileSetDefaultField.tsx"] .body14 {
      color: #26343C !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileForm"]
      [data-sentry-source-file="ChatProfileSetDefaultField.tsx"] .body12 {
      color: #7B888F !important;
      opacity: 1 !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileForm"]
      [data-sentry-source-file="ChatProfileSetDefaultField.tsx"]
      button > div[class*="h-5"][class*="w-9"] {
      background: #CDD4D8 !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileForm"]
      [data-sentry-source-file="ChatProfileSetDefaultField.tsx"]
      button > div[class*="bg-primary-"] {
      background: var(--kt-yellow) !important;
    }

    html.kt-profile-edit-active
      [data-sentry-component="ChatProfileForm"]
      [data-sentry-source-file="ChatProfileSetDefaultField.tsx"]
      button > div > div {
      background: #FFFFFF !important;
      box-shadow: 0 1px 3px rgba(45,55,61,.20) !important;
    }


    /* =========================================================
       v3.44 - 채팅 프로필 이미지 / 캐릭터 설명 팝업
       접힌 상태와 더보기 상태 공통
    ========================================================= */

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        [data-sentry-component="CharacterImageCarousel"]
      ) > [role="presentation"] {
      background: rgba(43,57,66,.28) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        [data-sentry-component="CharacterImageCarousel"]
      ) > div[class*="bg-gray-main"] {
      background: var(--kt-chat) !important;
      color: var(--kt-text) !important;
      box-shadow: 0 0 28px rgba(38,52,61,.16) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterImageCarousel"] {
      background: #FFFFFF !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterImageCarousel"]
      [data-sentry-component="ZoomableContainer"] {
      background: #FFFFFF !important;
    }

    /* 사진 위 프로필 정보 레이어 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterImageCarousel"]
      + div[aria-hidden] {
      background: rgba(255,255,255,.94) !important;
      color: var(--kt-text) !important;
      backdrop-filter: blur(8px) !important;
    }

    /* 상단 닫기 / 이름 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterImageCarousel"]
      + div[aria-hidden] > div:first-child {
      background: rgba(255,255,255,.96) !important;
      border-bottom: 1px solid var(--kt-line) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterImageCarousel"]
      + div[aria-hidden] > div:first-child h3,
    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterImageCarousel"]
      + div[aria-hidden] > div:first-child button,
    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterImageCarousel"]
      + div[aria-hidden] > div:first-child svg {
      color: #202124 !important;
    }

    /* 설명 본문 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterDescription"] {
      background: transparent !important;
      color: #394A54 !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterDescription"]
      [data-sentry-component="HeaderBottomMasked"] {
      mask: none !important;
      -webkit-mask: none !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterDescription"]
      .body1,
    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterDescription"] p,
    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterDescription"] li,
    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterDescription"] li > span[aria-hidden="true"] {
      color: #53636C !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterDescription"] h1,
    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterDescription"] h2,
    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterDescription"] h3,
    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterDescription"] strong {
      color: #26343C !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterDescription"] hr {
      border-color: #DDE4E8 !important;
    }

    /* 접힌 상태의 더보기 버튼 */
    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterDescription"] button {
      background: var(--kt-yellow) !important;
      color: #3B3514 !important;
      border: 1px solid #E2CC00 !important;
      border-radius: 999px !important;
      padding: 5px 10px !important;
      text-decoration: none !important;
      box-shadow: 0 1px 3px rgba(91,82,16,.14) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterDescription"] button:hover {
      background: var(--kt-yellow-hover) !important;
    }

    html.${ACTIVE} #portal-container
      [data-sentry-component="CharacterDescription"]
      div[class*="overflow-y-auto"] {
      scrollbar-width: thin !important;
      scrollbar-color: rgba(70,88,99,.22) transparent !important;
    }


    /* =========================================================
       v3.48 - 대화 캡처 선택 / 미리보기
    ========================================================= */

    /* 선택 화면 상단바 */
    html.${ACTIVE} [data-sentry-component="CaptureModeHeader"],
    html.${ACTIVE} [data-sentry-component="CaptureModeHeader"] > header,
    html.${ACTIVE} [data-sentry-component="CaptureModeHeader"] nav {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      border-color: var(--kt-line) !important;
    }

    html.${ACTIVE} [data-sentry-component="CaptureModeHeader"] {
      border-bottom: 1px solid var(--kt-line) !important;
      box-shadow: 0 1px 3px rgba(45,61,71,.06) !important;
    }

    /* Zeta 원본 헤더가 text-white를 쓰므로 제목/선택 해제까지 전부 밝은 헤더용 색으로 고정 */
    html.${ACTIVE} [data-sentry-component="CaptureModeHeader"] h1,
    html.${ACTIVE} [data-sentry-component="CaptureModeHeader"] h2,
    html.${ACTIVE} [data-sentry-component="CaptureModeHeader"] h3,
    html.${ACTIVE} [data-sentry-component="CaptureModeHeader"] h4,
    html.${ACTIVE} [data-sentry-component="CaptureModeHeader"] button,
    html.${ACTIVE} [data-sentry-component="CaptureModeHeader"] span,
    html.${ACTIVE} [data-sentry-component="CaptureModeHeader"] svg,
    html.${ACTIVE} [data-sentry-component="CaptureModeHeader"] [class*="text-white"] {
      color: #26343C !important;
    }

    /*
       모든 메시지 위에 CaptureSelector 버튼이 하나씩 덮여 있다.
       기본 상태에 노란 배경을 주면 캡처 모드에 들어간 순간 화면 전체가 노랗게 보이므로
       평상시 선택 레이어는 완전 투명하게 둔다.
    */
    html.${ACTIVE} [data-sentry-component="ChatMessageCaptureSelector"] {
      background: transparent !important;
      border-color: transparent !important;
      outline: none !important;
      box-shadow: none !important;
    }

    /* 마우스를 올린 후보만 아주 약하게 표시 */
    html.${ACTIVE} [data-sentry-component="ChatMessageCaptureSelector"]:hover {
      background: rgba(254,229,0,.055) !important;
    }

    /*
       선택 상태는 Zeta가 붙이는 상태값/primary 클래스를 따라가서 그때만 카카오 노랑으로 표시.
       (상태 구현이 바뀌어도 흔한 aria/data-state/class 형태를 모두 대응)
    */
    html.${ACTIVE} [data-sentry-component="ChatMessageCaptureSelector"][aria-pressed="true"],
    html.${ACTIVE} [data-sentry-component="ChatMessageCaptureSelector"][aria-selected="true"],
    html.${ACTIVE} [data-sentry-component="ChatMessageCaptureSelector"][data-state="selected"],
    html.${ACTIVE} [data-sentry-component="ChatMessageCaptureSelector"][data-selected="true"],
    html.${ACTIVE} [data-sentry-component="ChatMessageCaptureSelector"][class*="bg-primary-"],
    html.${ACTIVE} [data-sentry-component="ChatMessageCaptureSelector"][class*="border-primary-"] {
      background: rgba(254,229,0,.10) !important;
      border-color: #D9C300 !important;
      box-shadow: inset 0 0 0 1px rgba(217,195,0,.24) !important;
    }

    /* 선택 상태가 버튼의 부모(메시지 컨테이너)에 붙는 버전도 대응 */
    html.${ACTIVE} [data-sentry-component="BodyView"]:has(
      [data-sentry-component="ChatMessageCaptureSelector"][aria-pressed="true"]
    ),
    html.${ACTIVE} [data-sentry-component="BodyView"]:has(
      [data-sentry-component="ChatMessageCaptureSelector"][aria-selected="true"]
    ),
    html.${ACTIVE} [data-sentry-component="BodyView"]:has(
      [data-sentry-component="ChatMessageCaptureSelector"][data-state="selected"]
    ),
    html.${ACTIVE} [data-sentry-component="BodyView"]:has(
      [data-sentry-component="ChatMessageCaptureSelector"][data-selected="true"]
    ) {
      box-shadow: inset 0 0 0 1px rgba(217,195,0,.24) !important;
      background: rgba(254,229,0,.06) !important;
    }

    /* 선택 완료 하단바 */
    html.${ACTIVE} [data-sentry-component="CaptureModeBottom"] {
      background: rgba(255,255,255,.97) !important;
      border-top: 1px solid var(--kt-line) !important;
      box-shadow: 0 -4px 12px rgba(45,61,71,.08) !important;
    }

    html.${ACTIVE} [data-sentry-component="CaptureModeBottom"] > button {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      border: 1px solid #DFC900 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} [data-sentry-component="CaptureModeBottom"] > button:hover {
      background: var(--kt-yellow-hover) !important;
    }

    /* 완성된 캡처 미리보기 */
    html.${ACTIVE} [data-sentry-component="CapturePreview"] {
      background: var(--kt-chat) !important;
      color: var(--kt-text) !important;
      color-scheme: light !important;
    }

    html.${ACTIVE} [data-sentry-component="CapturePreview"] > header {
      background: #FFFFFF !important;
      color: var(--kt-text) !important;
      border-bottom: 1px solid var(--kt-line) !important;
      box-shadow: 0 1px 3px rgba(45,61,71,.06) !important;
    }

    html.${ACTIVE} [data-sentry-component="CapturePreview"] > header h3,
    html.${ACTIVE} [data-sentry-component="CapturePreview"] > header button,
    html.${ACTIVE} [data-sentry-component="CapturePreview"] > header svg {
      color: #26343C !important;
    }

    html.${ACTIVE} [data-sentry-component="CapturePreview"]
      > div[class*="overflow-y-auto"] {
      background: var(--kt-chat) !important;
      scrollbar-width: thin !important;
      scrollbar-color: rgba(70,88,99,.22) transparent !important;
    }

    html.${ACTIVE} [data-sentry-component="CapturePreview"]
      > div[class*="overflow-y-auto"] > div
      > div[class*="bg-gray-main"] {
      background: var(--kt-chat) !important;
    }


    /* =========================================================
       v3.48.2 - 마지막 메시지 컨트롤 4버튼 + 메시지 액션 바텀시트
       제타그램은 건드리지 않고 채팅 화면에만 적용
    ========================================================= */

    /* 신고 / 수정 / 요청 재생성 / 답변 재생성: 한 톤으로 통일 */
    html.${ACTIVE} [data-sentry-component="LastMessageControlBar"]
      button[aria-label="Report message"],
    html.${ACTIVE} [data-sentry-component="LastMessageControlBar"]
      button[aria-label="Edit message"],
    html.${ACTIVE} [data-sentry-component="LastMessageControlBar"]
      button[aria-label="Regenerate with a request"],
    html.${ACTIVE} [data-sentry-component="LastMessageControlBar"]
      button[aria-label="Regenerate answers"] {
      background: #EEF1F3 !important;
      color: #53636C !important;
      border: 1px solid #DDE4E8 !important;
      box-shadow: 0 1px 3px rgba(45,61,71,.08) !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} [data-sentry-component="LastMessageControlBar"]
      button[aria-label="Report message"]:hover:not(:disabled),
    html.${ACTIVE} [data-sentry-component="LastMessageControlBar"]
      button[aria-label="Edit message"]:hover:not(:disabled),
    html.${ACTIVE} [data-sentry-component="LastMessageControlBar"]
      button[aria-label="Regenerate with a request"]:hover:not(:disabled),
    html.${ACTIVE} [data-sentry-component="LastMessageControlBar"]
      button[aria-label="Regenerate answers"]:hover:not(:disabled) {
      background: #E4EAED !important;
      border-color: #D4DDE2 !important;
    }

    html.${ACTIVE} [data-sentry-component="LastMessageControlBar"]
      button[aria-label="Report message"] svg,
    html.${ACTIVE} [data-sentry-component="LastMessageControlBar"]
      button[aria-label="Edit message"] svg,
    html.${ACTIVE} [data-sentry-component="LastMessageControlBar"]
      button[aria-label="Regenerate with a request"] svg,
    html.${ACTIVE} [data-sentry-component="LastMessageControlBar"]
      button[aria-label="Regenerate answers"] svg {
      color: #53636C !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} [data-sentry-component="LastMessageControlBar"]
      button:disabled {
      background: #E7EAEC !important;
      color: #A4ADB2 !important;
      border-color: #DEE3E6 !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} [data-sentry-component="LastMessageControlBar"]
      button:disabled svg {
      color: #A4ADB2 !important;
    }

    /* 메시지 길게누르기/메뉴 바텀시트 */
    html.${ACTIVE} .kt-message-actions-backdrop {
      background: rgba(43,57,66,.34) !important;
      backdrop-filter: blur(7px) !important;
    }

    html.${ACTIVE} .kt-message-actions-sheet {
      background: #FFFFFF !important;
      color: #26343C !important;
      border-top: 1px solid #DDE4E8 !important;
      box-shadow: 0 -10px 30px rgba(38,52,61,.18) !important;
    }

    /* 드래그 손잡이 */
    html.${ACTIVE} .kt-message-actions-sheet > div:first-child svg {
      color: #AAB4BA !important;
    }

    /* 액션 행 */
    html.${ACTIVE} .kt-message-actions-sheet
      button[data-sentry-component="LogRawButton"] {
      background: #F6F8F9 !important;
      color: #34434C !important;
      border-color: #E2E7EA !important;
      box-shadow: none !important;
    }

    html.${ACTIVE} .kt-message-actions-sheet
      button[data-sentry-component="LogRawButton"]:hover:not(:disabled),
    html.${ACTIVE} .kt-message-actions-sheet
      button[data-sentry-component="LogRawButton"]:active:not(:disabled) {
      background: #EEF2F4 !important;
    }

    html.${ACTIVE} .kt-message-actions-sheet
      button[data-sentry-component="LogRawButton"] span,
    html.${ACTIVE} .kt-message-actions-sheet
      button[data-sentry-component="LogRawButton"] svg {
      color: #34434C !important;
      opacity: 1 !important;
    }

    html.${ACTIVE} .kt-message-actions-sheet
      button[data-sentry-component="LogRawButton"]:disabled,
    html.${ACTIVE} .kt-message-actions-sheet
      button[data-sentry-component="LogRawButton"]:disabled span,
    html.${ACTIVE} .kt-message-actions-sheet
      button[data-sentry-component="LogRawButton"]:disabled svg {
      color: #A5AEB3 !important;
      background-color: #F1F3F4 !important;
      opacity: 1 !important;
    }

    /* 삭제만 의미색 유지. 배경은 다른 메뉴와 동일하게 */
    html.${ACTIVE} .kt-message-actions-sheet
      button.kt-message-action-danger,
    html.${ACTIVE} .kt-message-actions-sheet
      button.kt-message-action-danger span,
    html.${ACTIVE} .kt-message-actions-sheet
      button.kt-message-action-danger svg {
      color: #D94B4B !important;
    }

    html.${ACTIVE} .kt-message-actions-sheet
      button.kt-message-action-danger:hover:not(:disabled),
    html.${ACTIVE} .kt-message-actions-sheet
      button.kt-message-action-danger:active:not(:disabled) {
      background: #FFF1F1 !important;
    }

    /* =========================================================
       v3.49 - 대화방 안의 대화 프로필 편집 모달
       ChatProfileEditForm.tsx / portal-container Modal.tsx
    ========================================================= */

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        [data-sentry-component="ChatProfileEditForm"]
      ) > [role="presentation"] {
      background: rgba(43,57,66,.28) !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        [data-sentry-component="ChatProfileEditForm"]
      ) > div[class*="bg-gray-main"] {
      background: #FFFFFF !important;
      color: #202124 !important;
      box-shadow: 0 10px 32px rgba(32,42,48,.16) !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        [data-sentry-component="ChatProfileEditForm"]
      ) > div[class*="bg-gray-main"] > div:first-child {
      background: #FFFFFF !important;
      color: #202124 !important;
      border-bottom-color: #E7EAEC !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        [data-sentry-component="ChatProfileEditForm"]
      ) > div[class*="bg-gray-main"] > div:first-child h3,
    html.kt-profile-edit-active #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        [data-sentry-component="ChatProfileEditForm"]
      ) > div[class*="bg-gray-main"] > div:first-child button,
    html.kt-profile-edit-active #portal-container
      [data-sentry-component="KeyboardAvoidingView"]:has(
        [data-sentry-component="ChatProfileEditForm"]
      ) > div[class*="bg-gray-main"] > div:first-child svg {
      color: #26343C !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"],
    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"] > div {
      background: #FFFFFF !important;
      color: #202124 !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      [data-sentry-component="Preview"] .title18,
    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      [data-sentry-component="FormSection"] :is(.heading3,.body16) {
      color: #2B3439 !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      [data-sentry-component="FormSection"] :is(.body12,[class*="text-white/50"]),
    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      [data-sentry-component="TextareaField"] :is(.caption12,.text-primary-300) {
      color: #77848A !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      label[data-sentry-component="Input"] {
      background: #F5F6F7 !important;
      color: #202124 !important;
      border-color: #DFE4E7 !important;
      box-shadow: none !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      label[data-sentry-component="Input"]:focus-within,
    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      textarea[data-sentry-component="Textarea"]:focus {
      background: #FFFFFF !important;
      border-color: #C7CED2 !important;
      box-shadow: 0 0 0 3px rgba(254,229,0,.20) !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      input[data-sentry-component="Input"],
    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      textarea[data-sentry-component="Textarea"] {
      background: #F5F6F7 !important;
      color: #202124 !important;
      caret-color: #4A4A4A !important;
      border-color: #DFE4E7 !important;
      box-shadow: none !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      :is(input,textarea)::placeholder {
      color: #9AA2A6 !important;
      opacity: 1 !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      [data-sentry-component="Preview"] div[class*="bg-primary-400"] {
      background: var(--kt-yellow) !important;
      color: #303030 !important;
      border: 2px solid #FFFFFF !important;
      box-shadow: 0 1px 3px rgba(0,0,0,.12) !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      [data-sentry-component="Preview"] div[class*="bg-primary-400"] svg {
      color: #303030 !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      .kt-profile-edit-submit {
      background: var(--kt-yellow) !important;
      color: #191919 !important;
      box-shadow: none !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      .kt-profile-edit-submit:hover:not(:disabled),
    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      .kt-profile-edit-submit:active:not(:disabled) {
      background: var(--kt-yellow-hover) !important;
    }

    html.kt-profile-edit-active #portal-container
      [data-sentry-component="ChatProfileEditForm"]
      .kt-profile-edit-submit:disabled {
      background: #E7EAEC !important;
      color: #A0A8AC !important;
    }

  `;

  function isExactChatRoom() {
    const path = location.pathname.replace(/\/+$/, '');
    return (
      /^\/[^/]+\/rooms\/[^/]+$/.test(path) ||
      !!document.querySelector('textarea[aria-label="내용 입력하기"]') ||
      !!document.querySelector('[data-testid="chat-header-model"]')
    );
  }

  function isProfileEditPage() {
    const path = location.pathname.replace(/\/+$/, '');
    return (
      /^\/[^/]+\/my-plot-chat-profile\/[^/]+\/[^/]+\/edit$/.test(path) ||
      /^\/[^/]+\/chat-profile\/edit\/[^/]+$/.test(path) ||
      /^\/[^/]+\/chat-profile\/create$/.test(path) ||
      !!document.querySelector('[data-sentry-component="MyPlotChatProfileEdit"]') ||
      !!document.querySelector('[data-sentry-component="ChatProfileCreatePage"]') ||
      !!document.querySelector('[data-sentry-component="ChatProfileEditForm"]') ||
      !!document.querySelector(
        'main#contents [data-sentry-component="ChatProfileForm"]'
      )
    );
  }

  function isBookmarkPage() {
    const path = location.pathname.replace(/\/+$/, '');
    return (
      /^\/[^/]+\/rooms\/[^/]+\/bookmarks$/.test(path) ||
      !!document.querySelector('[data-sentry-component="BookmarkList"]')
    );
  }

  function isSavedRoomsPage() {
    const path = location.pathname.replace(/\/+$/, '');
    return (
      /^\/[^/]+\/plots\/[^/]+\/saved-rooms$/.test(path) ||
      !!document.querySelector('[data-sentry-component="SavedRoomListPage"]')
    );
  }

  function isSavedRoomPage() {
    const path = location.pathname.replace(/\/+$/, '');
    return (
      /^\/[^/]+\/plots\/[^/]+\/saved-rooms\/[^/]+$/.test(path) ||
      !!document.querySelector('[data-sentry-component="SavedRoomHeader"]')
    );
  }

  function isDiaryOpen() {
    return !!document.querySelector(
      '[role="dialog"][aria-label="일기"] [data-sentry-component="DiaryPanel"]'
    );
  }

  function isEndingOpen() {
    return !!document.querySelector(
      '[role="dialog"][aria-label="엔딩"] [data-sentry-component="EndingPanel"]'
    );
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function setActiveState() {
    document.documentElement.classList.toggle(ACTIVE, isExactChatRoom());
    document.documentElement.classList.toggle(
      PROFILE_EDIT_ACTIVE,
      isProfileEditPage()
    );
    document.documentElement.classList.toggle(
      BOOKMARK_ACTIVE,
      isBookmarkPage()
    );
    document.documentElement.classList.toggle(
      SAVED_ROOMS_ACTIVE,
      isSavedRoomsPage()
    );
    document.documentElement.classList.toggle(
      SAVED_ROOM_ACTIVE,
      isSavedRoomPage()
    );
    document.documentElement.classList.toggle(DIARY_ACTIVE, isDiaryOpen());
    document.documentElement.classList.toggle(ENDING_ACTIVE, isEndingOpen());
  }

  function clearMarkersOutsideChat() {
    if (isExactChatRoom()) return;

    document.documentElement.classList.remove(ACTIVE);

    document.querySelectorAll(
      '.kt-other,.kt-me,.kt-composer-box,.kt-chat-header-layer,.kt-top-spacer,.kt-profile-select-button,.kt-action-sheet,.kt-action-backdrop,.kt-sidebar-danger,.kt-sidebar-footer,.kt-snapshot-archive-modal,.kt-snapshot-archive-wrap,.kt-snapshot-viewer-modal,.kt-snapshot-viewer-wrap,.kt-snapshot-viewer-footer,.kt-snapshot-viewer-actions,.kt-snapshot-report,.kt-snapshot-share,.kt-message-panel,.kt-message-tabs,.kt-profile-hub-sheet,.kt-profile-hub-backdrop,.kt-profile-add-button,.kt-profile-hub-selected'
    ).forEach(el => {
      el.classList.remove(
        'kt-other',
        'kt-me',
        'kt-composer-box',
        'kt-chat-header-layer',
        'kt-top-spacer',
        'kt-profile-select-button',
        'kt-action-sheet',
        'kt-action-backdrop',
        'kt-sidebar-danger',
        'kt-sidebar-footer',
        'kt-snapshot-archive-modal',
        'kt-snapshot-archive-wrap',
        'kt-snapshot-viewer-modal',
        'kt-snapshot-viewer-wrap',
        'kt-snapshot-viewer-footer',
        'kt-snapshot-viewer-actions',
        'kt-snapshot-report',
        'kt-snapshot-share',
        'kt-message-panel',
        'kt-message-tabs',
        'kt-profile-hub-sheet',
        'kt-profile-hub-backdrop',
        'kt-profile-add-button',
        'kt-profile-hub-selected'
      );
    });
  }




  function clearSavedTitlePopupMarkers() {
    document.querySelectorAll(
      '.kt-saved-title-cancel,.kt-saved-title-submit'
    ).forEach(el => {
      el.classList.remove(
        'kt-saved-title-cancel',
        'kt-saved-title-submit'
      );
    });
  }

  function markSavedTitlePopup() {
    if (!isSavedRoomsPage()) {
      clearSavedTitlePopupMarkers();
      return;
    }

    document.querySelectorAll(
      '#portal-container [data-sentry-component="Popup"] button'
    ).forEach(btn => {
      const label = (btn.textContent || '').replace(/\s+/g, ' ').trim();

      btn.classList.toggle(
        'kt-saved-title-cancel',
        label === '취소'
      );

      btn.classList.toggle(
        'kt-saved-title-submit',
        label === '완료' || label === '저장'
      );
    });
  }

  function clearSavedRoomMarkers() {
    document.querySelectorAll('.kt-saved-room-continue').forEach(el => {
      el.classList.remove('kt-saved-room-continue');
    });
  }

  function markSavedRoomPage() {
    if (!isSavedRoomPage()) {
      clearSavedRoomMarkers();
      return;
    }

    document.querySelectorAll('button').forEach(btn => {
      const label = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (label === '대화 이어하기') {
        btn.classList.add('kt-saved-room-continue');
      }
    });
  }

  function clearProfileEditMarkers() {
    document.querySelectorAll(
      '.kt-profile-edit-badge,.kt-profile-edit-submit,.kt-profile-edit-footer'
    ).forEach(el => {
      el.classList.remove(
        'kt-profile-edit-badge',
        'kt-profile-edit-submit',
        'kt-profile-edit-footer'
      );
    });
  }


  function clearBookmarkMarkers() {
    document.querySelectorAll(
      '.kt-bookmark-edit-button,.kt-bookmark-remove-button'
    ).forEach(el => {
      el.classList.remove(
        'kt-bookmark-edit-button',
        'kt-bookmark-remove-button'
      );
    });
  }

  function markBookmarkPage() {
    if (!isBookmarkPage()) {
      clearBookmarkMarkers();
      return;
    }

    document.querySelectorAll(
      '[data-sentry-component="BookmarkListItem"] button'
    ).forEach(btn => {
      const label = (btn.textContent || '').replace(/\s+/g, ' ').trim();

      btn.classList.toggle('kt-bookmark-edit-button', label === '수정');
      btn.classList.toggle('kt-bookmark-remove-button', label === '해제');
    });
  }

  function markProfileEditPage() {
    if (!isProfileEditPage()) {
      clearProfileEditMarkers();
      return;
    }

    const root = document.querySelector(
      '[data-sentry-component="MyPlotChatProfileEdit"], ' +
      '[data-sentry-component="ChatProfileCreatePage"], ' +
      '[data-sentry-component="ChatProfileEditForm"], ' +
      '[data-sentry-component="ChatProfileForm"]'
    );

    if (root) {
      const profileButton = root.querySelector(
        '[data-sentry-source-file="ChatProfilePreview.tsx"] button, ' +
        '[data-sentry-component="Preview"] button'
      );

      const badge = profileButton?.querySelector(
        'div.absolute.right-0.bottom-0'
      );

      badge?.classList.add('kt-profile-edit-badge');
    }

    document.querySelectorAll('#portal-container button').forEach(btn => {
      const label = (btn.textContent || '').replace(/\s+/g, ' ').trim();

      if (
        label === '이 프로필 선택하기' ||
        label === '저장하기' ||
        label === '추가하기'
      ) {
        btn.classList.add('kt-profile-edit-submit');
        btn.parentElement?.classList.add('kt-profile-edit-footer');
      }
    });
  }

  function markChatHeader() {
    document.querySelectorAll(
      'main#contents > div > div > div[class*="top-0"][class*="z-30"]'
    ).forEach(el => el.classList.add('kt-chat-header-layer'));
  }

  function markBubbles() {
    document.querySelectorAll(
      '[data-sentry-component="ChatBubbleContainer"]'
    ).forEach(bubble => {
      bubble.classList.remove('kt-other', 'kt-me');

      if (bubble.closest('[data-sentry-component="LeftTextContent"]')) {
        bubble.classList.add('kt-other');
        return;
      }

      if (bubble.closest('[data-sentry-component="RightTextContent"]')) {
        bubble.classList.add('kt-me');
      }
    });
  }


  function markTopSpacer() {
    document.querySelectorAll('main#contents div.shrink-0').forEach(el => {
      const cls = String(el.className || '');
      if (cls.includes('h-[calc(52px_')) {
        el.classList.add('kt-top-spacer');
      }
    });
  }

  function markProfileSelect() {
    const root = document.querySelector(
      '[data-sentry-component="PlayerCharacterSelect"]'
    );

    if (!root) return;

    root.querySelectorAll(
      '[data-sentry-component="PlotProfileCard"] button'
    ).forEach(btn => {
      const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();

      if (text === '선택') {
        btn.classList.add('kt-profile-select-button');
      }
    });
  }



  function markProfileHub() {
    const dialog = document.querySelector(
      '#portal-container [role="dialog"][aria-label="대화 프로필"]'
    );

    if (!dialog) return;

    let sheet = dialog.parentElement;
    while (sheet && sheet.id !== 'portal-container') {
      const cls = String(sheet.className || '');
      if (cls.includes('rounded-t-[20px]') || cls.includes('bg-gray-sub1')) {
        sheet.classList.add('kt-profile-hub-sheet');

        const parent = sheet.parentElement;
        if (parent) {
          const backdrop = Array.from(parent.children).find(el =>
            el !== sheet && el.getAttribute?.('role') === 'presentation'
          );
          backdrop?.classList.add('kt-profile-hub-backdrop');
        }
        break;
      }
      sheet = sheet.parentElement;
    }

    /* '대화 프로필 추가' 버튼 */
    Array.from(dialog.querySelectorAll('button')).forEach(btn => {
      const label = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (label === '대화 프로필 추가') {
        btn.classList.add('kt-profile-add-button');
      }
    });

    /* 추천 프로필의 선택 체크 배지 */
    dialog.querySelectorAll('[data-sentry-component="ChatProfileListItem"]')
      .forEach(item => {
        const badge = Array.from(item.querySelectorAll('div')).find(el => {
          const cls = String(el.className || '');
          return cls.includes('rounded-full') && cls.includes('bg-primary-400') && !!el.querySelector('svg');
        });
        badge?.classList.add('kt-profile-hub-selected');
      });
  }

  function markActionPanel() {
    const dialog = document.querySelector(
      '#portal-container section[role="dialog"][aria-label="Chat actions"]'
    );

    if (!dialog) return;

    let sheet = dialog.parentElement;

    while (sheet && sheet.id !== 'portal-container') {
      const cls = String(sheet.className || '');

      if (
        cls.includes('rounded-t-[20px]') ||
        cls.includes('bg-gray-sub1')
      ) {
        sheet.classList.add('kt-action-sheet');

        const parent = sheet.parentElement;
        if (parent) {
          const backdrop = Array.from(parent.children).find(el =>
            el !== sheet &&
            el.getAttribute?.('role') === 'presentation'
          );

          backdrop?.classList.add('kt-action-backdrop');
        }

        break;
      }

      sheet = sheet.parentElement;
    }
  }


  function markSidebarMenu() {
    const sidebar = document.querySelector(
      '[data-sentry-component="ChatSidebar"]'
    );

    if (!sidebar) return;

    const dialog = sidebar.querySelector(
      '[role="dialog"][aria-label="Chat menu"]'
    );

    if (!dialog) return;

    /* 위험 액션 */
    dialog.querySelectorAll('button').forEach(btn => {
      const label = (btn.textContent || '').replace(/\s+/g, ' ').trim();

      btn.classList.toggle(
        'kt-sidebar-danger',
        label === '대화 삭제' || label === '대화방 나가기'
      );
    });

    /* 다이얼로그 마지막 직접 자식이 '대화방 나가기' footer */
    const directChildren = Array.from(dialog.children);
    const footer = directChildren.find(el => {
      const label = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return label === '대화방 나가기';
    });

    if (footer) {
      footer.classList.add('kt-sidebar-footer');
    }
  }


  function markSnapshotModals() {
    /* 스냅샷 보관함 */
    const archiveGrid = document.querySelector(
      '[aria-label="Snapshot archive"]'
    );

    if (archiveGrid) {
      const panel = archiveGrid.closest(
        'div.relative.flex.max-h-full.max-w-full.flex-col'
      );

      if (panel) {
        panel.classList.add('kt-snapshot-archive-modal');

        const wrap = panel.parentElement;
        if (wrap) {
          wrap.classList.add('kt-snapshot-archive-wrap');
        }
      }
    }

    /* 스냅샷 상세 보기 */
    const viewer = document.querySelector(
      '[aria-label="Show or hide snapshot controls"]'
    );

    if (viewer) {
      let panel = viewer.closest(
        'div.relative.flex.max-h-full.max-w-full.flex-col'
      );

      if (!panel) {
        let p = viewer.parentElement;

        while (p && p !== document.body) {
          const cls = String(p.className || '');

          if (
            cls.includes('max-h-full') &&
            cls.includes('max-w-full') &&
            cls.includes('bg-gray-main')
          ) {
            panel = p;
            break;
          }

          p = p.parentElement;
        }
      }

      if (panel) {
        panel.classList.add('kt-snapshot-viewer-modal');

        const wrap = panel.parentElement;
        if (wrap) {
          wrap.classList.add('kt-snapshot-viewer-wrap');
        }

        /* 하단 컨트롤 영역 */
        Array.from(panel.querySelectorAll('div')).forEach(el => {
          const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
          const cls = String(el.className || '');

          if (
            cls.includes('mt-auto') &&
            txt.includes('좋아요') &&
            txt.includes('싫어요') &&
            txt.includes('댓글로 공유하기')
          ) {
            el.classList.add('kt-snapshot-viewer-footer');

            const actionRow = Array.from(el.children).find(child => {
              const t = (child.textContent || '').replace(/\s+/g, ' ').trim();
              return t.includes('좋아요') && t.includes('싫어요');
            });

            actionRow?.classList.add('kt-snapshot-viewer-actions');
          }
        });

        panel.querySelectorAll('button').forEach(btn => {
          const txt = (btn.textContent || '').replace(/\s+/g, ' ').trim();

          btn.classList.toggle(
            'kt-snapshot-report',
            txt === '신고'
          );

          btn.classList.toggle(
            'kt-snapshot-share',
            txt === '댓글로 공유하기'
          );
        });
      }
    }
  }


  function markMessagePhone() {
    const shell = document.querySelector(
      '[data-testid="message-phone-shell"]'
    );

    if (!shell) return;

    const content = shell.querySelector(
      '[data-testid="message-phone-content"]'
    );

    if (!content) return;

    const panel = Array.from(content.children).find(el => {
      const cls = String(el.className || '');
      return (
        el instanceof HTMLElement &&
        cls.includes('z-10') &&
        cls.includes('rounded-[24px]')
      );
    });

    if (!panel) return;

    panel.classList.add('kt-message-panel');

    /* 친구/채팅 두 탭이 있는 하단 바 */
    Array.from(panel.querySelectorAll('div')).forEach(el => {
      const buttons = Array.from(el.children).filter(
        child => child.tagName === 'BUTTON'
      );

      if (buttons.length !== 2) return;

      const labels = buttons.map(btn =>
        (btn.textContent || '').replace(/\s+/g, ' ').trim()
      );

      if (
        labels.includes('친구') &&
        labels.includes('채팅')
      ) {
        el.classList.add('kt-message-tabs');
      }
    });
  }

  function markComposer() {
    const textarea = document.querySelector(
      'textarea[aria-label="내용 입력하기"]'
    );

    if (!textarea) return;

    let p = textarea.parentElement;

    for (let i = 0; p && i < 4; i++, p = p.parentElement) {
      if (p.querySelector(':scope > textarea[aria-label="내용 입력하기"]')) {
        p.classList.add('kt-composer-box');
        break;
      }
    }
  }


  function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function clearAuxiliaryMarkers() {
    document.documentElement.classList.remove('kt-continue-open');

    [
      'kt-continue-screen',
      'kt-continue-empty',
      'kt-continue-panel',
      'kt-continue-empty-wrap',
      'kt-delete-mode-screen',
      'kt-delete-notice',
      'kt-delete-mode-button',
      'kt-delete-mode-button-row',
      'kt-theme-dialog-layer',
      'kt-theme-dialog',
      'kt-dialog-confirm',
      'kt-dialog-cancel',
      'kt-dialog-danger',
      'kt-dialog-checkrow',
      'kt-message-actions-layer',
      'kt-message-actions-backdrop',
      'kt-message-actions-sheet',
      'kt-message-action-danger',
      'kt-profile-hub-sheet',
      'kt-profile-hub-backdrop',
      'kt-profile-add-button',
      'kt-profile-hub-selected'
    ].forEach(cls => {
      document.querySelectorAll('.' + cls).forEach(el => el.classList.remove(cls));
    });
  }

  function markContinueScreen() {
    const main = document.querySelector('main#contents');
    if (!main) return;

    const text = normalizeText(main.textContent);
    const hasEmptyContinue =
      (text.includes('저장된 대화가 없어요') &&
        (text.includes('현재 대화를 저장할 수 있어요') || text.includes('새 대화를 시작하면'))) ||
      (text.includes('이야기하기') && text.includes('0/100') && text.includes('저장된 대화가 없어요'));

    if (!hasEmptyContinue) return;

    document.documentElement.classList.add('kt-continue-open');
    main.classList.add('kt-continue-screen');

    const empty = Array.from(main.querySelectorAll('div, p, span')).find(el =>
      normalizeText(el.textContent) === '저장된 대화가 없어요'
    );

    empty?.parentElement?.classList.add('kt-continue-empty');

    const titleEl = Array.from(main.querySelectorAll('div, p, span, h1, h2, h3')).find(el =>
      normalizeText(el.textContent) === '이야기하기'
    );

    let panel = null;

    if (empty) {
      panel = empty.closest('[data-testid="message-phone-content"] > div') ||
        empty.closest('div.relative') ||
        empty.parentElement;
    }

    if (!panel && titleEl) {
      let node = titleEl.parentElement;
      while (node && node !== main) {
        const cls = String(node.className || '');
        const txt = normalizeText(node.textContent);
        if ((cls.includes('rounded') || cls.includes('bg-') || cls.includes('max-w-') || cls.includes('z-10')) && txt.includes('저장된 대화가 없어요')) {
          panel = node;
          break;
        }
        node = node.parentElement;
      }
    }

    if (!panel) {
      panel = Array.from(main.querySelectorAll('div')).find(el => {
        const txt = normalizeText(el.textContent);
        return txt.includes('이야기하기') && txt.includes('저장된 대화가 없어요');
      }) || null;
    }

    panel?.classList.add('kt-continue-panel');
    empty?.closest('div')?.classList.add('kt-continue-empty-wrap');
  }

  function markDeleteMode() {
    const main = document.querySelector('main#contents');
    if (!main) return;

    const header = document.querySelector('[data-sentry-component="DeleteModeHeader"]');
    const text = normalizeText(main.textContent);
    const isDeleteMode = !!header || (text.includes('선택 해제') && text.includes('대화 삭제'));
    if (!isDeleteMode) return;

    main.classList.add('kt-delete-mode-screen');

    const notice = Array.from(main.querySelectorAll('div, p, span')).find(el => {
      const txt = normalizeText(el.textContent);
      return txt.includes('삭제 시작점을 선택해주세요') || txt.includes('선택해주세요');
    });
    notice?.parentElement?.classList.add('kt-delete-notice');

    Array.from(document.querySelectorAll('main#contents button')).forEach(btn => {
      const txt = normalizeText(btn.textContent);
      if (txt !== '대화 삭제') return;
      if (btn.closest('[data-sentry-component="DeleteModeHeader"]')) return;

      btn.classList.add('kt-delete-mode-button');
      btn.parentElement?.classList.add('kt-delete-mode-button-row');
    });
  }

  function findSmallestDialog(root, matcher) {
    const candidates = Array.from(root.querySelectorAll('div')).filter(el => {
      const txt = normalizeText(el.textContent);
      return matcher(txt) && el.querySelectorAll('button').length >= 2;
    });

    if (!candidates.length) return null;

    candidates.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    return candidates[0];
  }


  function markMessageActionSheet() {
    const portal = document.getElementById('portal-container');
    if (!portal) return;

    portal.querySelectorAll('[data-sentry-component="KeyboardAvoidingView"]')
      .forEach(layer => {
        /* 신고 입력 폼 자체가 아니라, 메시지 액션 목록 바텀시트만 잡는다. */
        if (layer.querySelector('input[name="message-report-description"]')) return;

        const text = normalizeText(layer.textContent);
        const isMessageActionSheet =
          text.includes('신고 및 오류제보') &&
          text.includes('스냅샷') &&
          text.includes('책갈피 설정') &&
          text.includes('여기서부터 새로하기') &&
          text.includes('복사') &&
          text.includes('캡처') &&
          text.includes('삭제');

        if (!isMessageActionSheet) return;

        layer.classList.add('kt-message-actions-layer');

        const backdrop = Array.from(layer.children).find(el =>
          el.getAttribute?.('role') === 'presentation'
        );
        backdrop?.classList.add('kt-message-actions-backdrop');

        const sheet = Array.from(layer.children).find(el => {
          if (el === backdrop) return false;
          const cls = String(el.className || '');
          return cls.includes('rounded-t-') || cls.includes('bg-gray-sub1');
        });

        if (!sheet) return;
        sheet.classList.add('kt-message-actions-sheet');

        sheet.querySelectorAll('button[data-sentry-component="LogRawButton"]')
          .forEach(btn => {
            const label = normalizeText(btn.textContent);
            btn.classList.toggle('kt-message-action-danger', label === '삭제');
          });
      });
  }

  function markThemeDialogs() {
    const portal = document.getElementById('portal-container') || document.body;

    /* 채팅의 '정말로 삭제하시겠어요?' 팝업만 카카오톡 테마로 처리.
       제타그램 패널이 열린 상태에서는 이 추가 규칙을 적용하지 않는다. */
    const isChatDeleteConfirm = text =>
      !document.querySelector('[data-testid="zetagram-panel"]') &&
      text.includes('정말로 삭제하시겠어요?') &&
      text.includes('삭제한 대화는 되돌릴 수 없어요');

    const isTargetDialog = text => {
      return (
        text.includes('대화를 새로 시작할까요?') ||
        text.includes('여기서부터 새로 할까요?') ||
        text.includes("기존 대화는 '이어하기'에서 언제든 다시 할 수 있어요") ||
        text.includes('선택 기능을 실행하면') ||
        text.includes('추천 답변이 사라져요') ||
        text.includes('현재 대화를 저장하고 이어할까요?') ||
        text.includes('선택한 대화를 이어하면') ||
        text.includes('현재 대화 저장하기') ||
        text.includes('저장된 대화를 삭제하시겠어요?') ||
        isChatDeleteConfirm(text) ||
        text.includes('비공개 대화로 전환할까요?') ||
        text.includes('스냅샷 생성에 실패하면 피스는 환불돼요')
      );
    };

    const layers = Array.from(portal.children && portal.children.length ? portal.children : [portal]);

    layers.forEach(layer => {
      const layerText = normalizeText(layer.textContent);
      if (!isTargetDialog(layerText)) return;

      layer.classList.add('kt-theme-dialog-layer');

      let dialog = findSmallestDialog(layer, isTargetDialog);

      if (!dialog) {
        dialog = Array.from(layer.querySelectorAll('div'))
          .filter(el => isTargetDialog(normalizeText(el.textContent)) && el.querySelectorAll('button').length >= 2)
          .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0];
      }

      if (!dialog) return;

      let panel = dialog;
      let p = dialog.parentElement;
      while (p && p !== layer && p !== document.body) {
        const cls = String(p.className || '');
        const txt = normalizeText(p.textContent);
        if (txt && isTargetDialog(txt) && (cls.includes('rounded') || cls.includes('shadow') || cls.includes('bg-') || p.querySelectorAll('button').length >= 2)) {
          panel = p;
        }
        p = p.parentElement;
      }

      panel.classList.add('kt-theme-dialog');

      if (normalizeText(panel.textContent).includes('스냅샷 생성에 실패하면 피스는 환불돼요')) {
        panel.classList.add('kt-snapshot-confirm-dialog');
        layer.classList.add('kt-snapshot-confirm-layer');
      }

      Array.from(panel.querySelectorAll('button')).forEach(btn => {
        const txt = normalizeText(btn.textContent);

        if (txt === '취소' || txt === '저장 안함') {
          btn.classList.add('kt-dialog-cancel');
        }

        if (
          txt === '확인' ||
          txt === '저장' ||
          txt === '이동하기' ||
          txt === '계속하기' ||
          txt === '전환' ||
          txt === '삭제하기' ||
          txt === '새로하기'
        ) {
          btn.classList.add('kt-dialog-confirm');
        }

        if (txt === '삭제') {
          btn.classList.add('kt-dialog-danger');
        }
      });

      const checkRow = Array.from(panel.querySelectorAll('label, button, div, span')).find(el => {
        const txt = normalizeText(el.textContent);
        return txt === '현재 대화 저장하기' || txt === '다시 보지 않기';
      });

      checkRow?.classList.add('kt-dialog-checkrow');
    });
  }


  function markSnapshotLoading() {
    const root = document.querySelector('main#contents') || document.body;
    if (!root) return;

    document.querySelectorAll('.kt-snapshot-loading-card').forEach(el =>
      el.classList.remove('kt-snapshot-loading-card')
    );

    const candidates = Array.from(root.querySelectorAll('div')).filter(el => {
      const txt = normalizeText(el.textContent);
      return (
        txt.includes('잊지 못할 순간을 만들고 있어요') &&
        txt.includes('스냅샷 생성은')
      );
    });

    if (!candidates.length) return;

    candidates.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    const content = candidates[0];

    let panel = content;
    let p = content;

    while (p && p !== root && p !== document.body) {
      const cls = String(p.className || '');

      if (
        cls.includes('rounded') &&
        (cls.includes('bg-') || cls.includes('aspect') || cls.includes('w-') || cls.includes('h-'))
      ) {
        panel = p;
        break;
      }

      p = p.parentElement;
    }

    panel.classList.add('kt-snapshot-loading-card');
  }

  function apply() {
    installStyle();
    setActiveState();

    /* 오버레이/동적 카드류는 현재 경로와 무관하게 먼저 보정 */
    markThemeDialogs();
    markSnapshotLoading();

    if (isProfileEditPage()) {
      clearMarkersOutsideChat();
      clearAuxiliaryMarkers();
      clearBookmarkMarkers();
      markProfileEditPage();
      return;
    }

    if (isBookmarkPage()) {
      clearMarkersOutsideChat();
      clearAuxiliaryMarkers();
      clearProfileEditMarkers();
      clearSavedRoomMarkers();
      markBookmarkPage();
      return;
    }

    if (isSavedRoomsPage()) {
      clearMarkersOutsideChat();
      clearAuxiliaryMarkers();
      clearProfileEditMarkers();
      clearBookmarkMarkers();
      clearSavedRoomMarkers();
      markSavedTitlePopup();
      markThemeDialogs();
      markSnapshotLoading();
      return;
    }

    if (isSavedRoomPage()) {
      clearMarkersOutsideChat();
      clearAuxiliaryMarkers();
      clearProfileEditMarkers();
      clearBookmarkMarkers();
      markSavedRoomPage();
      markThemeDialogs();
      markSnapshotLoading();
      return;
    }

    clearProfileEditMarkers();
    clearBookmarkMarkers();
    clearSavedRoomMarkers();
    clearSavedTitlePopupMarkers();

    if (!isExactChatRoom()) {
      clearMarkersOutsideChat();
      clearAuxiliaryMarkers();
      return;
    }

    markChatHeader();
    markTopSpacer();
    markBubbles();
    markProfileSelect();
    markProfileHub();
    markActionPanel();
    markSidebarMenu();
    markSnapshotModals();
    markMessagePhone();
    markComposer();
    clearAuxiliaryMarkers();
    markMessageActionSheet();
    markContinueScreen();
    markDeleteMode();
    markThemeDialogs();
    markSnapshotLoading();
  }

  let queued = false;

  function scheduleApply() {
    if (queued) return;
    queued = true;

    requestAnimationFrame(() => {
      queued = false;
      apply();
    });
  }

  function patchHistory() {
    const pushState = history.pushState;
    history.pushState = function (...args) {
      const result = pushState.apply(this, args);
      scheduleApply();
      return result;
    };

    const replaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = replaceState.apply(this, args);
      scheduleApply();
      return result;
    };

    window.addEventListener('popstate', scheduleApply);
  }


  function installBoardReactionProxy() {
    if (document.documentElement.dataset.ktBoardReactionProxy === '1') return;
    document.documentElement.dataset.ktBoardReactionProxy = '1';

    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const stat = target.closest(
        '[data-testid="board-post-block"] [data-sentry-component="PostStats"] ' +
        '[data-sentry-component="Stat"][aria-label^="공감"]'
      );
      if (!stat) return;

      const dialog = stat.closest('[role="dialog"][aria-label="익명 게시판"]');
      if (!dialog) return;

      const reactionButton = dialog.querySelector('button[aria-label="공감"]');
      if (!reactionButton || reactionButton.disabled) return;

      event.preventDefault();
      event.stopPropagation();
      reactionButton.click();
    }, true);
  }

  function start() {
    installBoardReactionProxy();
    apply();
    patchHistory();

    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  installStyle();
  setActiveState();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
