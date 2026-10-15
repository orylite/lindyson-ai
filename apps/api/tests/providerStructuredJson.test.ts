import { describe, expect, it } from 'vitest';
import { parseProviderStructuredJson } from '../src/providers/providerStructuredJson.js';

const ERROR_OPTIONS = {
  emptyMessage: 'Provider未返回JSON',
  invalidMessage: 'Provider未返回合法JSON',
  emptyCode: 'TEST_EMPTY_JSON',
  invalidCode: 'TEST_INVALID_JSON',
};

function parse(value: string) {
  return parseProviderStructuredJson(value, ERROR_OPTIONS);
}

describe('Provider结构化JSON安全恢复器', () => {
  it('直接接受合法JSON，并恢复BOM与完整代码围栏', () => {
    expect(parse('{"标题":"商品演示"}')).toEqual({ 标题: '商品演示' });
    expect(parse('\uFEFF```json\n{"标题":"商品演示"}\n```'))
      .toEqual({ 标题: '商品演示' });
  });

  it('只从说明文字中抽取唯一且完整的顶层对象', () => {
    expect(parse('以下是结果：\n{"标题":"商品演示","镜头":[1,2]}\n请查收'))
      .toEqual({ 标题: '商品演示', 镜头: [1, 2] });
  });

  it('确定性恢复裸控制字符、非法转义、正文引号和尾逗号', () => {
    const value = '{"说明":"第一行\n第二行含有"重点"和路径C:\\video", "完成":true,}';
    expect(parse(value)).toEqual({
      说明: '第一行\n第二行含有"重点"和路径C:\\video',
      完成: true,
    });
  });

  it('拒绝截断内容、多个对象和非对象根节点，不猜测补全', () => {
    for (const value of [
      '{"标题":"截断"',
      '{"a":1}\n{"b":2}',
      '[{"a":1}]',
    ]) {
      expect(() => parse(value)).toThrowError(expect.objectContaining({
        code: 'TEST_INVALID_JSON',
      }));
    }
  });

  it('空正文保留独立错误分类', () => {
    expect(() => parse(' \n\t')).toThrowError(expect.objectContaining({
      code: 'TEST_EMPTY_JSON',
    }));
  });
});
