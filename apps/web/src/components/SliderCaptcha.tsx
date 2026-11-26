import React, { useRef, useState } from 'react';
import { Button, Space, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

export interface SliderPuzzle {
  background: string;
  piece: string;
  width: number;
  height: number;
  pieceSize: number;
  pieceY: number;
}

interface Props {
  puzzle: SliderPuzzle;
  disabled?: boolean;
  onVerify: (x: number) => void;
  onRefresh?: () => void;
}

/** 自研图形滑块：拖动拼图块对齐缺口，松手后提交 X 坐标由服务端校验 */
export default function SliderCaptcha({ puzzle, disabled, onVerify, onRefresh }: Props) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startOffset: 0 });
  const maxOffset = puzzle.width - puzzle.pieceSize;

  const clamp = (value: number) => Math.min(maxOffset, Math.max(0, value));

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    setDragging(true);
    dragRef.current = { startX: e.clientX, startOffset: offset };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) return;
    setOffset(clamp(dragRef.current.startOffset + (e.clientX - dragRef.current.startX)));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || disabled) return;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (offset > 2) onVerify(Math.round(offset));
  };

  const reset = () => setOffset(0);

  return (
    <div>
      <Typography.Text type="secondary">拖动下方滑块，使拼图块对齐缺口后松手</Typography.Text>
      <div
        style={{
          position: 'relative',
          width: puzzle.width,
          maxWidth: '100%',
          height: puzzle.height,
          marginTop: 10,
          borderRadius: 10,
          overflow: 'hidden',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <img src={puzzle.background} alt="验证背景" style={{ width: '100%', height: '100%', display: 'block' }} />
        <img
          src={puzzle.piece}
          alt="拼图块"
          draggable={false}
          style={{
            position: 'absolute',
            top: puzzle.pieceY,
            left: offset,
            width: puzzle.pieceSize,
            height: puzzle.pieceSize,
            cursor: disabled ? 'not-allowed' : 'grab',
            filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.35))',
          }}
        />
      </div>
      <div
        style={{
          position: 'relative',
          height: 40,
          marginTop: 12,
          background: '#f0f2f5',
          borderRadius: 20,
          border: '1px solid #e5e7eb',
          overflow: 'hidden',
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: offset + puzzle.pieceSize,
            background: 'linear-gradient(90deg, #bae0ff, #91caff)',
            transition: dragging ? 'none' : 'width 0.15s',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: offset,
            width: puzzle.pieceSize - 4,
            height: 34,
            borderRadius: 17,
            background: disabled ? '#d9d9d9' : '#1668dc',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: disabled ? 'not-allowed' : 'grab',
            fontWeight: 600,
            transition: dragging ? 'none' : 'left 0.15s',
          }}
        >
          →
        </div>
      </div>
      <Space style={{ marginTop: 10 }}>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => { reset(); onRefresh?.(); }} disabled={disabled}>
          换一张
        </Button>
        <Typography.Text type="secondary">松开即提交校验</Typography.Text>
      </Space>
    </div>
  );
}
