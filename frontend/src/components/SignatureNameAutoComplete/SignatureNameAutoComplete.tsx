import { useMemo } from 'react';
import { AutoComplete, Form } from 'antd';
import type { FormInstance } from 'antd/es/form';
import type { AutoCompleteProps } from 'antd';
import { matchSignatureNamesForAutocomplete } from '../../utils/signatureRealNameExpand';

export type SignatureNameAutoCompleteProps = {
  names: readonly string[];
  watchForm: FormInstance;
  fieldName: string;
} & Omit<AutoCompleteProps, 'options' | 'filterOption'>;

/**
 * 护士/医生姓名签名：按用户管理中「逐字拼音首字母链」在输入为纯字母时过滤候选项并下拉展示；可选汉字子串匹配。
 */
export function SignatureNameAutoComplete({
  names,
  watchForm,
  fieldName,
  ...acProps
}: SignatureNameAutoCompleteProps) {
  const raw = Form.useWatch(fieldName, watchForm);
  const options = useMemo(
    () => matchSignatureNamesForAutocomplete(String(raw ?? ''), names),
    [raw, names],
  );
  return (
    <AutoComplete
      allowClear
      filterOption={false}
      options={options}
      style={{ width: '100%', minWidth: 0 }}
      popupMatchSelectWidth={280}
      {...acProps}
    />
  );
}
