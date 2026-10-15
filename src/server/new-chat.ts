"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function startNewChat() {
  // A cached home page can contain the ID of a chat that was already created.
  revalidatePath("/", "page");
  redirect("/");
}
