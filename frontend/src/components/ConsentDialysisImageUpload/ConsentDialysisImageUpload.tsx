/**
 * 透析知情同意书影像：支持「本地相册/文件」与「拍照」两种来源，再走 Ant Design Upload 预览与删除。
 */
import { useRef, useCallback } from 'react';
import { Upload, Dropdown, message } from 'antd';
import type { RcFile, UploadFile } from 'antd/es/upload/interface';
import type { MenuProps } from 'antd';

const ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,image/gif';
const MAX_MB = 5;

function isAllowedImage(file: File): boolean {
  if (file.type && file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif)$/i.test(file.name);
}

export interface ConsentDialysisImageUploadProps {
  fileList?: UploadFile[];
  onChange?: (info: { fileList: UploadFile[] }) => void;
  maxCount?: number;
  /** picture-card 触发区主文案 */
  triggerLabel?: string;
}

export default function ConsentDialysisImageUpload({
  fileList,
  onChange,
  maxCount = 15,
  triggerLabel = '上传',
}: ConsentDialysisImageUploadProps) {
  const list = fileList ?? [];
  /** 单一 file input，避免双 input 在部分浏览器中仍显示原生「选择文件」行 */
  const fileInputRef = useRef<HTMLInputElement>(null);

  const emit = useCallback(
    (next: UploadFile[]) => {
      onChange?.({ fileList: next });
    },
    [onChange]
  );

  const appendFiles = useCallback(
    (raw: File[]) => {
      const currentList = fileList ?? [];
      const room = maxCount - currentList.length;
      if (room <= 0) return;
      const toAdd: UploadFile[] = [];
      for (const file of raw) {
        if (toAdd.length >= room) break;
        if (!isAllowedImage(file)) {
          message.error('仅支持 JPG、PNG、WebP、GIF 图片');
          continue;
        }
        if (file.size > MAX_MB * 1024 * 1024) {
          message.error(`单张图片不超过 ${MAX_MB}MB`);
          continue;
        }
        toAdd.push({
          uid: `consent-${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${file.name}`,
          name: file.name || 'image',
          status: 'done',
          originFileObj: file as RcFile,
        });
      }
      if (toAdd.length) emit([...currentList, ...toAdd]);
    },
    [fileList, maxCount, emit]
  );

  const resetFileInputForNextOpen = (el: HTMLInputElement) => {
    el.value = '';
    el.removeAttribute('capture');
    el.multiple = true;
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const { files } = el;
    if (files?.length) appendFiles(Array.from(files));
    resetFileInputForNextOpen(el);
  };

  const openGalleryPicker = () => {
    const el = fileInputRef.current;
    if (!el) return;
    resetFileInputForNextOpen(el);
    el.multiple = true;
    el.removeAttribute('capture');
    el.click();
  };

  const openCameraPicker = () => {
    const el = fileInputRef.current;
    if (!el) return;
    resetFileInputForNextOpen(el);
    el.multiple = false;
    el.setAttribute('capture', 'environment');
    el.click();
  };

  const menuItems: MenuProps['items'] = [
    {
      key: 'gallery',
      label: '从相册 / 本地文件选择',
      onClick: () => openGalleryPicker(),
    },
    {
      key: 'camera',
      label: '拍照上传',
      onClick: () => openCameraPicker(),
    },
  ];

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        tabIndex={-1}
        aria-hidden
        style={{
          position: 'absolute',
          left: -9999,
          top: 0,
          width: 1,
          height: 1,
          opacity: 0,
          overflow: 'hidden',
        }}
        onChange={onFileInputChange}
      />
      <Upload
        accept={ACCEPT_ATTR}
        listType="picture-card"
        fileList={list}
        onChange={(info) => emit(info.fileList)}
        beforeUpload={() => false}
        openFileDialogOnClick={false}
        maxCount={maxCount}
        multiple
      >
        {list.length >= maxCount ? null : (
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <div className="ant-upload ant-upload-select" role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
              <div style={{ marginTop: 8 }}>{triggerLabel}</div>
            </div>
          </Dropdown>
        )}
      </Upload>
    </div>
  );
}
