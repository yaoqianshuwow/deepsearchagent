"use client";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-950 text-gray-200">
      <p>聊天不存在或无权访问</p>
      <button
        type="button"
        onClick={() => window.location.assign("/")}
        className="rounded bg-gray-700 px-4 py-2 hover:bg-gray-600"
      >
        返回首页
      </button>
    </main>
  );
}
