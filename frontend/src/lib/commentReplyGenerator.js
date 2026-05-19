export {
  COMMENT_REPLY_STATUSES,
  COMMENT_TYPES,
  DEFAULT_REPLY_FORBIDDEN_WORDS,
  DUPLICATE_RISKS,
  assessDuplicateRisk,
  collectCommentsByUrl,
  createCommentCollectionBridge,
  createCommentReplyBatch,
  createCommentReplyForOne,
  createMainKeywordCandidates,
  findForbiddenWords,
  normalizeComment,
  parseManualComments,
  resolveMainKeyword
} from "@shared/commentReplyGenerator.js";
