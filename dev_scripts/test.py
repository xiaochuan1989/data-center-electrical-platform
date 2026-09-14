#!/usr/bin/env python3
"""
数据中心电气设计与选型平台 - 测试入口
===========================

整合所有开发验证脚本，统一入口。

使用方法:
  python dev_scripts/test.py              # 运行快速检查
  python dev_scripts/test.py --check      # 基础检查
  python dev_scripts/test.py --prompt     # 提示词验证
  python dev_scripts/test.py --excel      # Excel 验证
  python dev_scripts/test.py --html       # HTML 验证
  python dev_scripts/test.py --js         # JS 代码扫描
  python dev_scripts/test.py --audit      # HTML/JS 结构审计
"""

import os
import sys
import subprocess
import argparse
import shutil
from pathlib import Path
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# 项目根目录
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEV_SCRIPTS_DIR = PROJECT_ROOT / "dev_scripts"
MAIN_HTML = "index.html"


def run_script(script_path: Path, description: str) -> bool:
    """运行单个测试脚本"""
    print(f"\n{'='*50}")
    print(f"🧪 {description}")
    print(f"{'='*50}")

    if not script_path.exists():
        print(f"❌ 脚本不存在: {script_path}")
        return False

    try:
        if script_path.suffix in {".js", ".mjs"}:
            executable = shutil.which("node")
            if not executable:
                print("❌ 未找到 Node.js")
                return False
            command = [executable, str(script_path)]
        else:
            command = [sys.executable, str(script_path)]

        result = subprocess.run(
            command,
            capture_output=False,
            text=True,
            cwd=PROJECT_ROOT
        )
        return result.returncode == 0
    except Exception as e:
        print(f"❌ 运行失败: {e}")
        return False


def check_environment():
    """检查开发环境"""
    print("\n" + "="*50)
    print("🔍 开发环境检查")
    print("="*50)

    checks = []

    # Python 版本
    py_version = f"{sys.version_info.major}.{sys.version_info.minor}"
    checks.append(("Python 版本", f"{py_version} (>= 3.8)", sys.version_info >= (3, 8)))

    # 检查关键文件
    files = [
        (MAIN_HTML, "主程序文件"),
        ("常用UPS速查表-V8.0.xlsx", "产品数据"),
        ("UPS选型助手_开发文档.md", "开发文档"),
    ]

    for filename, desc in files:
        path = PROJECT_ROOT / filename
        checks.append((desc, filename, path.exists()))

    # 检查目录
    dirs = [
        ("src/", "源代码目录"),
        ("dev_scripts/", "开发脚本目录"),
    ]

    for dirname, desc in dirs:
        path = PROJECT_ROOT / dirname
        checks.append((desc, dirname, path.exists()))

    # 输出结果
    all_pass = True
    for name, expected, result in checks:
        status = "✅" if result else "❌"
        detail = expected if not result else ""
        print(f"  {status} {name} {detail}")
        if not result:
            all_pass = False

    return all_pass


def check_html_structure():
    """检查 HTML 结构"""
    html_path = PROJECT_ROOT / MAIN_HTML
    if not html_path.exists():
        print(f"❌ {MAIN_HTML} 不存在")
        return False

    content = html_path.read_text(encoding='utf-8')

    checks = [
        ("DOCTYPE", "<!DOCTYPE html>" in content),
        ("UTF-8 编码", 'charset="UTF-8"' in content),
        ("SheetJS", "xlsx-js-style" in content or "sheetjs.com" in content),
        ("mammoth.js", "mammoth" in content),
        ("产品数据", "PRODUCTS" in content),
        ("系统提示词", "DEFAULT_SYSTEM_PROMPT" in content),
    ]

    print("\n📋 HTML 结构检查:")
    all_pass = True
    for name, result in checks:
        status = "✅" if result else "❌"
        print(f"  {status} {name}")
        if not result:
            all_pass = False

    # 统计
    lines = content.count('\n') + 1
    size_kb = len(content) / 1024
    print(f"\n📊 文件统计:")
    print(f"  行数: {lines}")
    print(f"  大小: {size_kb:.1f} KB")

    return all_pass


def check_server_entry():
    """确保未安装可选watchdog时，开发服务器入口仍可加载。"""
    result = subprocess.run(
        [sys.executable, str(DEV_SCRIPTS_DIR / "serve.py"), "--help"],
        cwd=PROJECT_ROOT,
        text=True,
        capture_output=True,
        encoding="utf-8",
    )
    if result.returncode == 0 and "--no-open" in result.stdout:
        print("  ✅ 开发服务器入口")
        return True
    print("  ❌ 开发服务器入口")
    if result.stderr:
        print(result.stderr.strip())
    return False


def main():
    parser = argparse.ArgumentParser(description="UPS 测试入口")
    parser.add_argument("--all", action="store_true", help="运行所有测试")
    parser.add_argument("--env", action="store_true", help="环境检查")
    parser.add_argument("--check", action="store_true", help="基础检查（环境 + HTML）")
    parser.add_argument("--prompt", action="store_true", help="提示词验证")
    parser.add_argument("--excel", action="store_true", help="Excel 验证")
    parser.add_argument("--html", action="store_true", help="HTML 验证")
    parser.add_argument("--js", action="store_true", help="JS 代码扫描")
    parser.add_argument("--audit", action="store_true", help="HTML/JS 结构审计")
    parser.add_argument("--version", action="store_true", help="版本一致性检查")
    parser.add_argument("--quick", action="store_true", help="快速检查（环境 + HTML）")

    args = parser.parse_args()

    # 打印标题
    print("="*50)
    print("⚡ 数据中心电气设计与选型平台 - 测试系统")
    print("="*50)
    print(f"项目路径: {PROJECT_ROOT}")
    print(f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # 默认运行快速检查
    if not any([args.all, args.env, args.check, args.prompt, args.excel, args.html, args.js, args.audit, args.version, args.quick]):
        args.quick = True

    results = {}

    # 环境检查
    if args.env or args.check or args.quick or args.all:
        results['环境'] = check_environment()
        results['开发服务器'] = check_server_entry()

    # HTML 检查
    if args.html or args.check or args.quick or args.all:
        results['HTML'] = check_html_structure()

    # 运行验证脚本
    if args.prompt or args.all:
        results['提示词'] = run_script(
            DEV_SCRIPTS_DIR / "check_prompt_feature.py",
            "提示词功能验证"
        )

    if args.excel or args.all:
        results['Excel'] = run_script(
            DEV_SCRIPTS_DIR / "inspect_excel.py",
            "Excel 数据结构检查"
        )

    if args.js or args.all:
        results['JS'] = run_script(
            DEV_SCRIPTS_DIR / "scan_js.py",
            "JavaScript 代码扫描"
        )

    if args.audit or args.quick or args.all:
        results['结构审计'] = run_script(
            DEV_SCRIPTS_DIR / "audit_html.py",
            "HTML/JavaScript 结构审计"
        )

    if args.quick or args.all:
        results['v2平台'] = run_script(
            DEV_SCRIPTS_DIR / "test_platform_v2.mjs",
            "v2 平台与工程计算测试"
        )
        results['业务规则'] = run_script(
            DEV_SCRIPTS_DIR / "test_business_rules.js",
            "核心业务规则测试"
        )
        results['目录价匹配'] = run_script(
            DEV_SCRIPTS_DIR / "check_catalog_enrichment.py",
            "UPS 编码与目录价严格匹配检查"
        )

    if args.all:
        results['HTML深度检查'] = run_script(
            DEV_SCRIPTS_DIR / "check_html.py",
            "HTML 数据与关键函数检查"
        )
        results['数据库视图'] = run_script(
            DEV_SCRIPTS_DIR / "verify.py",
            "双表数据库视图检查"
        )

    if args.version or args.quick or args.all:
        results['版本'] = run_script(
            DEV_SCRIPTS_DIR / "check_version.py",
            "版本一致性检查"
        )

    # 总结
    print("\n" + "="*50)
    print("📊 测试总结")
    print("="*50)

    if results:
        passed = sum(1 for v in results.values() if v)
        total = len(results)
        print(f"通过: {passed}/{total}")

        for name, result in results.items():
            status = "✅ 通过" if result else "❌ 失败"
            print(f"  {name}: {status}")
    else:
        print("未运行任何测试")
        print("\n使用方法:")
        print("  python dev_scripts/test.py --quick     快速检查")
        print("  python dev_scripts/test.py --all       运行所有测试")
        print("  python dev_scripts/test.py --prompt    提示词验证")
        print("  python dev_scripts/test.py --excel     Excel 验证")
        print("  python dev_scripts/test.py --html      HTML 验证")
        print("  python dev_scripts/test.py --js        JS 代码扫描")
        print("  python dev_scripts/test.py --audit     HTML/JS 结构审计")
        print("  python dev_scripts/test.py --version   版本一致性检查")

    print("="*50)
    return 0 if results and all(results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
