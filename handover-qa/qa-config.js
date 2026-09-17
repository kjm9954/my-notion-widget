/*
 * 인수인계 Q&A 위젯의 공개 설정 — 목록형(index.html)과 질문형(add.html)이 함께 읽는다.
 *
 * 이 파일은 공개 저장소로 배포되므로 서버 주소·이미지 한도·일반 화면 문구만 둔다.
 * 사람 이름·역할 설명·카테고리와 그 단어가 들어간 문구는 방 설정으로 서버에 두고
 * 접근 키가 있을 때만 받아 이 값 위에 덮어쓴다(README의 "방 설정" 참고).
 * 접근 키는 여기에 적지 않는다. 키는 임베드 주소의 #k= 로만 전달한다.
 */
window.QA_CONFIG = {
  api: 'https://notion-widget.wldnjsdkk.workers.dev',
  pollMs: 5000,

  images: {
    max: 5,                        // 질문 한 번에 붙일 수 있는 장수
    maxSide: 1600,                 // 붙여넣은 이미지의 긴 변 상한(px)
    quality: 0.85,                 // JPEG 품질
    maxBytes: 3 * 1024 * 1024,     // 변환 후 한 장 상한. 넘으면 등록을 막는다
  },

  // 방 설정이 없을 때 쓰는 빈 값. 실제 값은 방 설정이 채운다.
  users: [],
  categories: [],
  fallbackCategory: null,
  devComposeCategory: null,

  text: {
    brand: 'HANDOVER Q&A',
    statusDesc: {
      '대기': '아직 답변이 없음',
      '답변됨': '답변이 달림',
      '확인완료': '질문한 사람이 내용을 확인함',
    },

    // 접근 키가 없거나 설정을 받지 못했을 때(두 위젯 공통)
    access: {
      noKeyTitle: '질문 기능이 연결되지 않았어요',
      noKeyDesc: '이 임베드 주소에 접근 키가 없습니다. 인수인계 페이지의 위젯 주소를 다시 복사해 붙여주세요.',
      expiredTitle: '접근 키가 만료됐어요',
      expiredDesc: '키를 새로 발급해 임베드 주소를 갱신해야 합니다.',
      offlineTitle: '질문함에 연결하지 못했어요',
      offlineDesc: '네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
      notReadyTitle: '방 설정이 비어 있어요',
      notReadyDesc: '관리자가 이 접근 키의 사용자와 카테고리를 등록해야 합니다.',
      retry: '다시 시도',
    },

    // 목록형
    list: {
      pinnedForAnswerer: '새 질문 도착 · 답변 대기',
      pinnedForAsker: '새 답변 도착',
      placeholderForAnswerer: '답변을 입력하세요',
      placeholderForAsker: '꼬리 질문을 입력하세요',
      keyRejected: '접근 키가 만료됐거나 권한이 없습니다. 임베드 주소를 다시 확인해 주세요.',
    },

    // 가이드 페이지 하단 입력 전용 임베드(index.html?mode=compose)
    compose: {
      eyebrow: '이 페이지에 대해 질문하기',
      doneDesc: '답변이 달리면 인수인계 페이지 목록 맨 위에 뜹니다.',
    },

    // 질문형(add.html)
    add: {
      title: '질문 남기기',
      desc: '등록하면 아래 질문함 맨 위에 올라갑니다.',
      changeAuthor: '작성자 변경',

      setupTitle: '누구로 질문을 남기시나요?',
      setupDesc: '이 브라우저에 저장되고 다시 묻지 않습니다.',

      labelCategory: '카테고리',
      labelTitle: '제목',
      labelBody: '내용',
      labelMine: '내가 남긴 질문',
      titlePlaceholder: '[대상] + 궁금한 점',
      bodyPlaceholder: '어디까지 해봤고 무엇이 막혔는지. 스크린샷은 Ctrl+V',

      similarLabel: '비슷한 질문',
      similarOpen: '보기',
      similarClose: '접기',
      similarLoading: '불러오는 중…',
      similarError: '스레드를 불러오지 못했어요',
      similarRetry: '다시 시도',
      similarImage: '이미지 크게 보기',
      solved: '해결됐어요',
      keepWriting: '계속 작성',
      solvedToast: '작성 중이던 내용을 비웠어요',

      imageSlot: 'Ctrl+V',
      imageSlotLabel: '이미지 붙이기',
      removeImage: '이미지 빼기',
      imageCount: '이미지 {n}/{max}',
      draftSaved: '임시 저장됨',
      imageTooBig: '{mb}MB가 넘는 이미지는 빼고 등록해 주세요',
      imageLimit: '이미지는 {max}장까지 붙일 수 있어요',
      imageAdded: '이미지 {n}장을 붙였어요',
      imageFailed: '이미지를 읽지 못했어요',

      cancel: '취소',
      submit: '등록',

      progress: '등록 중',
      stages: ['이미지 업로드', '질문 파일 생성', '목록 갱신'],
      stageLine: '{stage} · {i}/{n}',
      done: '아래 목록에 등록됐어요',
      again: '하나 더',
      failed: '등록하지 못했어요 · 내용은 남아 있어요',
      retry: '재시도',
      failedLine: '{stage} 실패 · {reason}',
      reasonRetries: '{n}회 재시도 후 중단',
      reasonNetwork: '연결 끊김',
      reasonHttp: 'HTTP {status}',

      deniedTitle: '저장소에 쓸 권한이 없어요',
      deniedDesc: '관리자에게 권한 범위를 확인해 주세요.',
      deniedCode: '403 · 쓰기 권한 필요',
    },
  },
};
