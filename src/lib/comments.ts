/**
 * Serializable comments view models shared by the server page and client tabs.
 */

export interface CommentProviderSummary {
  identifier: string;
  name: string;
  version: string;
  reads: string[];
  writes: string[];
}

export interface ProjectCommentAuthor {
  id: string;
  username: string;
  avatar: string | null;
}

export interface ProjectCommentView {
  id: string;
  author: ProjectCommentAuthor | null;
  body: string;
  format: string;
  plaintext: string;
  createdAt: string;
}

export interface ProjectCommentsData {
  provider: CommentProviderSummary | null;
  comments: ProjectCommentView[];
  canComment: boolean;
}
