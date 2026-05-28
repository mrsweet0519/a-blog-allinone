export {
  DEFAULT_REPLY_FORBIDDEN_WORDS,
  assessDuplicateRisk,
  collectCommentsByUrl,
  createCommentCollectionBridge,
  createCommentReplyBatch,
  createCommentReplyForOne,
  createMainKeywordCandidates,
  generateContextualCaptureReplies,
  generateContextualCaptureReply,
  findForbiddenWords,
  normalizeComment,
  parseCapturedComments,
  parseManualComments,
  parseNaverCommentsFromText,
  resolveMainKeyword,
  splitForbiddenWords
} from "../../../shared/commentReplyGenerator.js";
