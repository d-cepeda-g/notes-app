"use client";

import React from "react";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";

export default function NoteEmojiPicker({ onEmojiSelect, onClickOutside }: {
  onEmojiSelect: (emoji: { native: string }) => void;
  onClickOutside: () => void;
}) {
  return <Picker data={data} onEmojiSelect={onEmojiSelect} autoFocus searchPosition="top" onClickOutside={onClickOutside} />;
}
