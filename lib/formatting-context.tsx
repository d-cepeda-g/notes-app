"use client";

import { createContext, useContext, useState, useCallback, RefObject } from "react";

interface FormattingContextType {
  textareaRef: RefObject<HTMLTextAreaElement> | null;
  isEditable: boolean;
  saveNote: ((content: string) => void) | null;
  setEditorState: (
    ref: RefObject<HTMLTextAreaElement> | null,
    onSave: ((content: string) => void) | null,
    editable: boolean
  ) => void;
}

const FormattingContext = createContext<FormattingContextType>({
  textareaRef: null,
  isEditable: false,
  saveNote: null,
  setEditorState: () => {},
});

export function FormattingProvider({ children }: { children: React.ReactNode }) {
  const [textareaRef, setTextareaRef] = useState<RefObject<HTMLTextAreaElement> | null>(null);
  const [saveNote, setSaveNote] = useState<((content: string) => void) | null>(null);
  const [isEditable, setIsEditable] = useState(false);

  const setEditorState = useCallback(
    (
      ref: RefObject<HTMLTextAreaElement> | null,
      onSave: ((content: string) => void) | null,
      editable: boolean
    ) => {
      setTextareaRef(ref);
      setSaveNote(() => onSave);
      setIsEditable(editable);
    },
    []
  );

  return (
    <FormattingContext.Provider
      value={{
        textareaRef,
        isEditable,
        saveNote,
        setEditorState,
      }}
    >
      {children}
    </FormattingContext.Provider>
  );
}

export function useFormatting() {
  return useContext(FormattingContext);
}
