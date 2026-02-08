#!/usr/bin/env python3
"""
简单的公网部署脚本
使用 serveo.net 或 localtunnel 实现内网穿透
"""

import subprocess
import time
import os
import sys

def start_ngrok():
    """使用 localtunnel (npx)"""
    print("🚀 启动 localtunnel...")
    try:
        proc = subprocess.Popen(
            ['npx', '--yes', 'localtunnel', '--port', '3000'],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True
        )
        return proc
    except Exception as e:
        print(f"❌ localtunnel 失败: {e}")
        return None

def start_serveo():
    """使用 serveo.net SSH隧道"""
    print("🚀 启动 serveo.net 隧道...")
    try:
        proc = subprocess.Popen(
            ['ssh', '-o', 'StrictHostKeyChecking=no', 
             '-R', '80:localhost:3000', 'serveo.net'],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True
        )
        return proc
    except Exception as e:
        print(f"❌ serveo 失败: {e}")
        return None

def start_bore():
    """使用 bore.pub"""
    print("🚀 启动 bore.pub 隧道...")
    try:
        # 下载 bore
        subprocess.run(
            ['curl', '-sL', 'https://bore.pub/3.8.4/x86_64-unknown-linux-gnu/bore', 
             '-o', '/tmp/bore'],
            check=True
        )
        os.chmod('/tmp/bore', 0o755)
        
        proc = subprocess.Popen(
            ['/tmp/bore', 'pub', 'localhost:3000'],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True
        )
        return proc
    except Exception as e:
        print(f"❌ bore 失败: {e}")
        return None

def main():
    print("=" * 50)
    print("🎮 三人五子棋 - 公网部署工具")
    print("=" * 50)
    
    # 先检查服务器是否运行
    result = subprocess.run(
        ['curl', '-s', 'http://localhost:3000'],
        capture_output=True
    )
    
    if result.returncode != 0:
        print("📦 启动游戏服务器...")
        os.chdir('/root/clawd/gomoku-3p')
        subprocess.Popen(
            ['node', 'server/index.js'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        time.sleep(2)
        print("✅ 服务器已启动")
    
    print("\n🌐 正在创建公网访问...")
    
    # 尝试不同的隧道服务
    tunnel_procs = []
    
    # 尝试 localtunnel
    proc = start_ngrok()
    if proc:
        tunnel_procs.append(('localtunnel', proc))
    
    # 等待输出
    time.sleep(10)
    
    # 检查输出
    for name, proc in tunnel_procs:
        output = proc.stdout.read()
        if output:
            print(f"\n{'='*50}")
            print(f"✅ {name} 连接成功!")
            print(f"{'='*50}")
            print(output)
            
            # 检查是否有URL
            if 'https://' in output or 'your url is' in output.lower():
                print(f"\n🎮 游戏地址: {output.strip()}")
                return
    
    print("\n❌ 未能创建公网隧道")
    print("\n💡 备选方案:")
    print("   1. 使用 Docker 部署到云服务器")
    print("   2. 使用 Railway/Render 一键部署")
    print("   3. 在有公网IP的服务器上运行")

if __name__ == '__main__':
    main()
