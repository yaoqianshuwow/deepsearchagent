import { AlertCircle } from "lucide-react";

interface ErrorMessageProps {
  message: string;
}

export const ErrorMessage = ({ message }: ErrorMessageProps) => {
  return (
    <div className="mx-auto w-full max-w-[65ch]">
      <div className="flex items-center gap-2 rounded-md bg-red-950 p-3 text-sm text-red-300">
        <AlertCircle className="size-5 shrink-0" />
        {message}
      </div>
    </div>
  );
};
