@echo off
setlocal enabledelayedexpansion
chcp 936 >nul
cd /d "%~dp0.."
set "ROOT=%CD%"

rem ===========================================================
rem  沙漏 Hourglass 一键打包
rem  产物：deploy\dist\Hourglass-<版本>\（Jar + 前端 dist + 配置）
rem        deploy\dist\Hourglass-<版本>.zip
rem  脚本位置：deploy\build.bat，与 deploy.sh 同目录
rem ===========================================================

set "APP_NAME=Hourglass"
set "JAR_NAME=hourglass-server.jar"
set "TARGET_JAR=target\%JAR_NAME%"

echo ============================================================
echo   沙漏 Hourglass 一键打包（Jar + 前端 dist + 配置）
echo ============================================================
echo.

rem ---------- 0. 环境检查 ----------
where mvn >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Maven，请先安装并加入 PATH。
    goto :fail
)
where java >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 Java，请先安装 JDK 8 并加入 PATH。
    goto :fail
)
echo [检查] Maven 与 Java 已就绪
echo.

rem ---------- 1. 检查旧包占用 ----------
if exist "%TARGET_JAR%" (
    ren "%TARGET_JAR%" "hourglass-server.jar.locktest" >nul 2>nul
    if errorlevel 1 (
        echo [错误] %TARGET_JAR% 被占用，无法重新打包。
        echo        请先停止正在运行的服务（java -jar hourglass-server.jar），
        echo        查看 java 进程：tasklist ^| findstr /i java
        goto :fail
    )
    ren "target\hourglass-server.jar.locktest" "%JAR_NAME%" >nul
)
echo [1/5] 环境与占用检查通过
echo.

rem ---------- 2. 构建 ----------
echo [2/5] Maven 打包（跳过测试）...
call mvn -B -DskipTests clean package
if errorlevel 1 (
    echo.
    echo [错误] 打包失败，请查看上方 Maven 日志。
    goto :fail
)
if not exist "%TARGET_JAR%" (
    echo [错误] 未找到构建产物 %TARGET_JAR%
    goto :fail
)
echo [完成] %TARGET_JAR%
echo.

rem ---------- 3. 组装交付包 ----------
rem 版本号优先取 Maven 生成的 pom.properties，避免从 pom.xml 里猜
set "VERSION="
if exist "target\maven-archiver\pom.properties" (
    for /f "usebackq tokens=2 delims==" %%V in (`findstr /b /c:"version=" "target\maven-archiver\pom.properties"`) do set "VERSION=%%V"
)
if not defined VERSION (
    rem 兜底：pom.xml 里第 1 个 version 是 Spring Boot 父版本，第 2 个才是项目版本
    set /a _ver_hits=0
    for /f "usebackq tokens=2 delims=<>" %%V in (`findstr /c:"<version>" pom.xml`) do (
        set /a _ver_hits+=1
        if !_ver_hits! equ 2 set "VERSION=%%V"
    )
)
if not defined VERSION set "VERSION=unknown"

set "PACKAGE=deploy\dist\%APP_NAME%-%VERSION%"
set "ZIP_FILE=%PACKAGE%.zip"
set "CONF_DIR=%PACKAGE%\config"
set "DEPLOY_DIR=%PACKAGE%\deploy"
set "SQL_DIR=%PACKAGE%\sql"

echo [3/5] 组装交付包（版本 %VERSION%）...
if exist "%PACKAGE%" (
    rmdir /s /q "%PACKAGE%"
    if exist "%PACKAGE%" (
        echo [错误] 无法删除 %PACKAGE%，可能被资源管理器或其它程序占用。
        goto :fail
    )
)
if exist "%ZIP_FILE%" del /q "%ZIP_FILE%" >nul 2>nul
mkdir "%CONF_DIR%" 2>nul
mkdir "%DEPLOY_DIR%" 2>nul
mkdir "%SQL_DIR%" 2>nul

copy /y "%TARGET_JAR%" "%PACKAGE%\%JAR_NAME%" >nul
if errorlevel 1 goto :pack_fail

robocopy "src\main\resources\static" "%PACKAGE%\frontend" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :pack_fail

copy /y "src\main\resources\application.yml" "%CONF_DIR%\application.yml" >nul
if errorlevel 1 goto :pack_fail
copy /y "deploy\conf\hourglass.env.example" "%CONF_DIR%\hourglass.env.example" >nul
if errorlevel 1 goto :pack_fail

copy /y "deploy\hourglass.service" "%DEPLOY_DIR%\hourglass.service" >nul
if errorlevel 1 goto :pack_fail
copy /y "deploy\nginx-hourglass.conf" "%DEPLOY_DIR%\nginx-hourglass.conf" >nul
if errorlevel 1 goto :pack_fail
copy /y "deploy\backup.sh" "%DEPLOY_DIR%\backup.sh" >nul
if errorlevel 1 goto :pack_fail
copy /y "deploy\README.md" "%DEPLOY_DIR%\README.md" >nul
if errorlevel 1 goto :pack_fail

copy /y "sql\baseline\01_schema_full.sql" "%SQL_DIR%\01_schema_full.sql" >nul
if errorlevel 1 goto :pack_fail
copy /y "sql\seeds\seed_yunying.sql" "%SQL_DIR%\seed_yunying.sql" >nul
if errorlevel 1 goto :pack_fail
copy /y "deploy\上线清单.md" "%SQL_DIR%\上线清单.md" >nul
if errorlevel 1 goto :pack_fail

set "JAR_SHA="
for /f "skip=1 delims=" %%H in ('certutil -hashfile "%PACKAGE%\%JAR_NAME%" SHA256') do if not defined JAR_SHA set "JAR_SHA=%%H"
if not "!JAR_SHA:~63,1!"=="" if "!JAR_SHA:~64,1!"=="" goto :sha_ok
set "JAR_SHA=n/a"
:sha_ok

> "%PACKAGE%\BUILD-INFO.txt" echo 沙漏 Hourglass 交付包
>> "%PACKAGE%\BUILD-INFO.txt" echo 版本       : %VERSION%
>> "%PACKAGE%\BUILD-INFO.txt" echo 打包时间   : %date% %time%
>> "%PACKAGE%\BUILD-INFO.txt" echo Jar SHA256 : %JAR_SHA%
>> "%PACKAGE%\BUILD-INFO.txt" echo.
>> "%PACKAGE%\BUILD-INFO.txt" echo 目录说明
>> "%PACKAGE%\BUILD-INFO.txt" echo   hourglass-server.jar           后端可执行包，前端静态资源已打入 jar
>> "%PACKAGE%\BUILD-INFO.txt" echo   frontend\                      前端静态资源，独立留存
>> "%PACKAGE%\BUILD-INFO.txt" echo   config\application.yml         外置配置，与 jar 同级的 config 目录会自动加载
>> "%PACKAGE%\BUILD-INFO.txt" echo   config\hourglass.env.example   环境变量模板，复制为 /etc/hourglass.env
>> "%PACKAGE%\BUILD-INFO.txt" echo   deploy\                        systemd 服务、nginx 反代、备份脚本、部署指南
>> "%PACKAGE%\BUILD-INFO.txt" echo   sql\                           建库脚本、种子数据与上线清单
>> "%PACKAGE%\BUILD-INFO.txt" echo.
>> "%PACKAGE%\BUILD-INFO.txt" echo 本地启动：在包根目录执行 java -jar hourglass-server.jar
echo [完成] 交付包目录已就绪
echo.

rem ---------- 4. 生成压缩包 ----------
echo [4/5] 生成压缩包...
powershell -NoProfile -Command "Compress-Archive -LiteralPath '%PACKAGE%' -DestinationPath '%ZIP_FILE%' -Force" >nul 2>nul
if errorlevel 1 (
    echo [警告] 压缩包生成失败，目录包仍可正常使用。
) else (
    echo [完成] %ROOT%\%ZIP_FILE%
)
echo.

rem ---------- 5. 汇总 ----------
echo [5/5] 打包完成：
for %%F in ("%PACKAGE%\%JAR_NAME%") do echo   Jar   : %%~fF  ^(%%~zF 字节^)
if exist "%ZIP_FILE%" for %%F in ("%ZIP_FILE%") do echo   压缩包: %%~fF  ^(%%~zF 字节^)
echo   前端  : %ROOT%\%PACKAGE%\frontend
echo.
echo 提示：deploy\deploy.sh 默认取 target\hourglass-server.jar；
echo       手动上传时直接取本交付包即可。
echo.
pause
exit /b 0

:pack_fail
echo [错误] 交付包组装失败，请检查上方输出，确认 deploy\ 与 sql\ 下的源文件齐全。
goto :fail

:fail
echo.
pause
exit /b 1
