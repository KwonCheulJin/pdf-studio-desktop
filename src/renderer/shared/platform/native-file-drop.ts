import {
  FILE_DROP_EVENT_TYPE,
  type ClientPoint,
  type FileDropEvent,
  type FileDropLeaveEvent
} from "./desktop-platform";

/** 웹뷰가 주는 드롭 좌표. 단위는 웹뷰마다 다르다(`toFileDropEvent`의 `pixelRatio`). */
export interface NativeDropPosition {
  x: number;
  y: number;
}

interface NativeFileDropEnterEvent {
  type: typeof FILE_DROP_EVENT_TYPE.ENTER;
  paths: string[];
  position: NativeDropPosition;
}

interface NativeFileDropOverEvent {
  type: typeof FILE_DROP_EVENT_TYPE.OVER;
  position: NativeDropPosition;
}

interface NativeFileDropDropEvent {
  type: typeof FILE_DROP_EVENT_TYPE.DROP;
  paths: string[];
  position: NativeDropPosition;
}

/** Tauri `onDragDropEvent`의 payload와 같은 모양 */
export type NativeFileDropEvent =
  | NativeFileDropEnterEvent
  | NativeFileDropOverEvent
  | NativeFileDropDropEvent
  | FileDropLeaveEvent;

interface ToFileDropEventParams {
  event: NativeFileDropEvent;
  /** 좌표 1 CSS 픽셀에 해당하는 웹뷰 좌표 단위 수. 물리 픽셀이면 `devicePixelRatio`, 이미 CSS 픽셀이면 1 */
  pixelRatio: number;
}

function toClientPoint(
  position: NativeDropPosition,
  pixelRatio: number
): ClientPoint {
  return { x: position.x / pixelRatio, y: position.y / pixelRatio };
}

/** 웹뷰 드롭 이벤트를 CSS 픽셀 좌표의 `FileDropEvent`로 바꾼다. */
export function toFileDropEvent({
  event,
  pixelRatio
}: ToFileDropEventParams): FileDropEvent {
  switch (event.type) {
    case FILE_DROP_EVENT_TYPE.ENTER:
    case FILE_DROP_EVENT_TYPE.DROP:
      return {
        type: event.type,
        paths: event.paths,
        point: toClientPoint(event.position, pixelRatio)
      };
    case FILE_DROP_EVENT_TYPE.OVER:
      return {
        type: event.type,
        point: toClientPoint(event.position, pixelRatio)
      };
    case FILE_DROP_EVENT_TYPE.LEAVE:
      return { type: event.type };
  }
}
