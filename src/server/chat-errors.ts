export class ChatAlreadyExistsError extends Error {
  constructor() {
    super("聊天 ID 已存在，请重新开始新对话");
  }
}

export class ChatStreamActiveError extends Error {
  constructor() {
    super("这段聊天仍在生成回复，请等待完成或重新连接");
  }
}
