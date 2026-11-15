package com.hourglass.common;

import com.hourglass.dto.TestCaseView;
import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.DataValidation;
import org.apache.poi.ss.usermodel.DataValidationConstraint;
import org.apache.poi.ss.usermodel.DataValidationHelper;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.FormulaEvaluator;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.PaperSize;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.VerticalAlignment;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.ss.util.CellRangeAddressList;
import org.apache.poi.xssf.usermodel.XSSFCell;
import org.apache.poi.xssf.usermodel.XSSFCellStyle;
import org.apache.poi.xssf.usermodel.XSSFClientAnchor;
import org.apache.poi.xssf.usermodel.XSSFColor;
import org.apache.poi.xssf.usermodel.XSSFComment;
import org.apache.poi.xssf.usermodel.XSSFDataValidationHelper;
import org.apache.poi.xssf.usermodel.XSSFDrawing;
import org.apache.poi.xssf.usermodel.XSSFFont;
import org.apache.poi.xssf.usermodel.XSSFRichTextString;
import org.apache.poi.xssf.usermodel.XSSFRow;
import org.apache.poi.xssf.usermodel.XSSFSheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.awt.Color;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 测试用例 Excel（.xlsx）读写。
 *
 * <p>写：表头品牌蓝底白字、列宽按内容设定、长文本自动换行并按行数估高、冻结编号/标题两列与表头、
 * 全表筛选、横向 A4 打印并重复表头；优先级与最近执行结果用浅底色区分。导入模板另附「填写说明」页，
 * 优先级列带下拉校验。读：只取第一个工作表，公式取缓存值，空行忽略。</p>
 */
public final class CaseExcel {

    /** 可回导的列：模板与导入按这些列名识别 */
    private static final String[] IMPORT_HEADERS = {
            "用例编号", "标题", "模块", "优先级", "前置条件", "测试数据", "测试步骤", "预期结果"
    };
    /** 导出列：前 8 列可回导，后 4 列是只读的执行信息（导入时明确忽略） */
    private static final String[] EXPORT_HEADERS = {
            "用例编号", "标题", "模块", "优先级", "前置条件", "测试数据", "测试步骤", "预期结果",
            "最近结果", "执行人", "执行时间", "最近备注"
    };
    private static final int[] COL_WIDTHS = {
            10, 34, 16, 8, 26, 24, 42, 42,
            10, 10, 17, 26
    };
    private static final int[] IMPORT_WIDTHS = {10, 34, 16, 8, 26, 24, 42, 42};

    private static final DateTimeFormatter TIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    private static final com.fasterxml.jackson.databind.ObjectMapper JSON =
            new com.fasterxml.jackson.databind.ObjectMapper();

    /* 与前端 tokens.css 的同名色值保持一致：主色 #2563EB，边框 #D0D5DD */
    private static final Color HEADER_BG = new Color(0x25, 0x63, 0xEB);
    private static final Color HEADER_LINE = new Color(0x1D, 0x4E, 0xD8);
    private static final Color BORDER = new Color(0xD0, 0xD5, 0xDD);
    private static final Color TEXT = new Color(0x1D, 0x29, 0x39);
    private static final Color TEXT_MUTED = new Color(0x98, 0xA2, 0xB3);

    private final XSSFWorkbook wb = new XSSFWorkbook();
    private final Map<String, XSSFCellStyle> styles = new HashMap<String, XSSFCellStyle>();

    private CaseExcel() {
        wb.getProperties().getCoreProperties().setCreator("沙漏 Hourglass");
        wb.getProperties().getCoreProperties().setTitle("测试用例");
    }

    /** 导出用例：前 8 列可回导，后 4 列是执行信息 */
    public static byte[] export(List<TestCaseView> rows, String projectName) {
        CaseExcel writer = new CaseExcel();
        return writer.writeCases(rows == null ? new ArrayList<TestCaseView>() : rows,
                sheetName(projectName), EXPORT_HEADERS, COL_WIDTHS, true);
    }

    /** 导入模板：可回导的 8 列 + 示例行 + 填写说明页；优先级列带下拉校验 */
    public static byte[] template() {
        CaseExcel writer = new CaseExcel();
        XSSFSheet sheet = writer.wb.createSheet("测试用例");
        writer.headerRow(sheet, IMPORT_HEADERS, IMPORT_WIDTHS);
        writer.exampleRow(sheet, IMPORT_WIDTHS);
        writer.finishSheet(sheet, 1, IMPORT_WIDTHS.length - 1);
        writer.comment(sheet, 0, "留空即可：导入后按项目顺序自动分配 TC-001、TC-002…");
        writer.comment(sheet, 4, "执行前需要满足的条件，可留空");
        writer.comment(sheet, 5, "执行时要准备或输入的账号、金额、边界值等，可留空");
        writer.comment(sheet, 6, "一行一步，行首写「1.」「2.」会被自动去掉；与「预期结果」按行号一一对应");
        writer.comment(sheet, 7, "与「测试步骤」按行号一一对应；某步没有预期结果可留空行");
        writer.priorityValidation(sheet, 999);
        writer.instructionsSheet();
        return writer.bytes();
    }

    /** 读取第一个工作表：返回二维文本表；公式取缓存值，尾随空行忽略 */
    public static List<List<String>> read(byte[] data) {
        if (data == null || data.length == 0) {
            throw AppException.badRequest("导入内容为空");
        }
        Workbook book = null;
        try {
            book = WorkbookFactory.create(new ByteArrayInputStream(data));
            if (book.getNumberOfSheets() == 0) {
                throw AppException.badRequest("Excel 里没有工作表");
            }
            Sheet sheet = book.getSheetAt(0);
            if (sheet.getLastRowNum() > 5000) {
                throw AppException.badRequest("工作表行数过多（上限 5000 行），请拆分文件");
            }
            DataFormatter fmt = new DataFormatter(Locale.CHINA);
            FormulaEvaluator evaluator = book.getCreationHelper().createFormulaEvaluator();
            int width = 0;
            for (Row row : sheet) {
                if (row != null) {
                    width = Math.max(width, Math.min(60, row.getLastCellNum()));
                }
            }
            List<List<String>> out = new ArrayList<List<String>>();
            for (int r = 0; r <= sheet.getLastRowNum(); r++) {
                Row row = sheet.getRow(r);
                List<String> cells = new ArrayList<String>(width);
                for (int c = 0; c < width; c++) {
                    cells.add(row == null ? "" : text(fmt, evaluator, row, c));
                }
                out.add(cells);
            }
            while (!out.isEmpty() && blank(out.get(out.size() - 1))) {
                out.remove(out.size() - 1);
            }
            return out;
        } catch (AppException ex) {
            throw ex;
        } catch (Exception ex) {
            throw AppException.badRequest("无法读取 Excel 文件，请确认是 .xlsx 或 .xls 格式");
        } finally {
            if (book != null) {
                try {
                    book.close();
                } catch (IOException ignored) {
                    // 只读内存流，关闭失败不影响结果
                }
            }
        }
    }

    /* ---------- 写 ---------- */

    private byte[] writeCases(List<TestCaseView> rows, String sheetName, String[] headers,
                              int[] widths, boolean withExecution) {
        XSSFSheet sheet = wb.createSheet(sheetName);
        headerRow(sheet, headers, widths);
        int r = 1;
        for (TestCaseView v : rows) {
            XSSFRow row = sheet.createRow(r);
            List<String> values = new ArrayList<String>();
            values.add(caseNo(v.getCaseNo()));
            values.add(v.getTitle());
            values.add(v.getModule());
            values.add(v.getPriority());
            values.add(v.getPrecondition());
            values.add(v.getTestData());
            values.add(stepActions(v));
            values.add(stepExpected(v));
            if (withExecution) {
                values.add(CaseMeta.statusLabel(v.getLatestStatus()));
                values.add(v.getLatestBy());
                values.add(v.getLatestAt() == null ? "" : TIME_FMT.format(v.getLatestAt()));
                values.add(v.getLatestNote());
            }
            for (int c = 0; c < values.size(); c++) {
                XSSFCell cell = row.createCell(c);
                cell.setCellValue(nullToEmpty(values.get(c)));
                cell.setCellStyle(styleFor(c, values.get(c), withExecution));
            }
            row.setHeightInPoints(height(values, widths));
            r++;
        }
        finishSheet(sheet, r - 1, headers.length - 1);
        return bytes();
    }

    private void headerRow(XSSFSheet sheet, String[] headers, int[] widths) {
        XSSFRow row = sheet.createRow(0);
        row.setHeightInPoints(27);
        for (int c = 0; c < headers.length; c++) {
            XSSFCell cell = row.createCell(c);
            cell.setCellValue(headers[c]);
            cell.setCellStyle(headerStyle());
            sheet.setColumnWidth(c, widths[c] * 256 + 320);
        }
    }

    private void exampleRow(XSSFSheet sheet, int[] widths) {
        List<String> values = new ArrayList<String>();
        values.add("");
        values.add("登录成功跳转首页");
        values.add("账号体系");
        values.add("P0");
        values.add("已注册账号 demo/123456");
        values.add("账号：demo / 密码：123456");
        values.add("1. 打开登录页\n2. 输入正确账号密码并提交");
        values.add("1. 出现用户名/密码输入框\n2. 3 秒内进入首页且右上角显示昵称");
        XSSFRow row = sheet.createRow(1);
        for (int c = 0; c < values.size(); c++) {
            XSSFCell cell = row.createCell(c);
            cell.setCellValue(values.get(c));
            cell.setCellStyle(styleFor(c, values.get(c), false));
        }
        row.setHeightInPoints(height(values, widths));
    }

    /** 冻结窗格、筛选、打印与页眉页脚：导出与模板共用 */
    private void finishSheet(XSSFSheet sheet, int lastRow, int lastCol) {
        sheet.createFreezePane(2, 1);
        if (lastRow > 0) {
            sheet.setAutoFilter(new CellRangeAddress(0, lastRow, 0, lastCol));
            sheet.setRepeatingRows(new CellRangeAddress(0, 0, -1, -1));
        }
        sheet.setFitToPage(true);
        sheet.getPrintSetup().setLandscape(true);
        sheet.getPrintSetup().setPaperSize(PaperSize.A4_PAPER);
        sheet.getPrintSetup().setFitWidth((short) 1);
        sheet.getPrintSetup().setFitHeight((short) 0);
        sheet.setMargin(Sheet.LeftMargin, 0.3);
        sheet.setMargin(Sheet.RightMargin, 0.3);
        sheet.setMargin(Sheet.TopMargin, 0.45);
        sheet.setMargin(Sheet.BottomMargin, 0.45);
        sheet.getHeader().setCenter("&\"微软雅黑\"&10测试用例");
        sheet.getFooter().setRight("第 &P 页 / 共 &N 页");
    }

    private void instructionsSheet() {
        XSSFSheet sheet = wb.createSheet("填写说明");
        sheet.setColumnWidth(0, 100 * 256);
        String[] lines = {
                "测试用例导入说明",
                "1. 只读取第一个工作表；单次最多 1000 行，标题为必填，其余列可留空。",
                "2. 优先级只能填 P0 / P1 / P2 / P3（可下拉选择）；留空表示未设置。",
                "3. 「模块」填功能模块名；项目里不存在的模块会自动建为顶级目录。",
                "4. 「测试步骤」与「预期结果」各一行一步、按行号一一对应；行首的「1.」「2.」导入时自动去掉。",
                "5. 某一步没有预期结果时，在「预期结果」里留一个空行，后续行仍按行号对应。",
                "6. 「最近结果 / 执行人 / 执行时间 / 最近备注」等执行信息不会导入，导入结果会列出被忽略的列。",
                "7. 外部用例编号不保留：导入后按项目顺序重新分配 TC-001、TC-002…",
                "8. 下面示例行导入前请删除，或直接改成你的第一条用例。"
        };
        for (int i = 0; i < lines.length; i++) {
            XSSFRow row = sheet.createRow(i);
            row.setHeightInPoints(i == 0 ? 30 : 22);
            XSSFCell cell = row.createCell(0);
            cell.setCellValue(lines[i]);
            XSSFCellStyle style = wb.createCellStyle();
            XSSFFont font = wb.createFont();
            font.setFontName("微软雅黑");
            font.setFontHeightInPoints((short) (i == 0 ? 14 : 10));
            font.setBold(i == 0);
            font.setColor(rgb(i == 0 ? HEADER_BG : TEXT));
            style.setFont(font);
            style.setWrapText(true);
            style.setVerticalAlignment(VerticalAlignment.CENTER);
            cell.setCellStyle(style);
        }
    }

    private void comment(XSSFSheet sheet, int col, String text) {
        XSSFDrawing drawing = sheet.createDrawingPatriarch();
        XSSFClientAnchor anchor = new XSSFClientAnchor(0, 0, 0, 0, col, 1, Math.min(col + 3, 7), 5);
        XSSFComment comment = drawing.createCellComment(anchor);
        comment.setAuthor("沙漏");
        comment.setString(new XSSFRichTextString(text));
        sheet.getRow(0).getCell(col).setCellComment(comment);
    }

    private void priorityValidation(XSSFSheet sheet, int lastRow) {
        DataValidationHelper helper = new XSSFDataValidationHelper(sheet);
        DataValidationConstraint constraint =
                helper.createExplicitListConstraint(new String[]{"P0", "P1", "P2", "P3"});
        CellRangeAddressList regions = new CellRangeAddressList(2, lastRow, 3, 3);
        DataValidation validation = helper.createValidation(constraint, regions);
        validation.setShowErrorBox(true);
        validation.setShowPromptBox(true);
        validation.setErrorStyle(DataValidation.ErrorStyle.STOP);
        validation.createErrorBox("优先级无效", "只能选择 P0 / P1 / P2 / P3，留空表示未设置。");
        validation.createPromptBox("优先级", "P0 最高，P3 最低；也可以留空。");
        sheet.addValidationData(validation);
    }

    private XSSFCellStyle styleFor(int col, String value, boolean withExecution) {
        if (col == 3) {
            return priorityStyle(value);
        }
        if (withExecution && col == 8) {
            return statusStyle(value);
        }
        if (col == 0 || (withExecution && (col == 9 || col == 10))) {
            return style("center");
        }
        return style("body");
    }

    private XSSFCellStyle headerStyle() {
        XSSFCellStyle cached = styles.get("header");
        if (cached != null) {
            return cached;
        }
        XSSFCellStyle style = wb.createCellStyle();
        style.setFillForegroundColor(rgb(HEADER_BG));
        style.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        style.setAlignment(HorizontalAlignment.CENTER);
        style.setVerticalAlignment(VerticalAlignment.CENTER);
        style.setBorderTop(BorderStyle.THIN);
        style.setBorderLeft(BorderStyle.THIN);
        style.setBorderRight(BorderStyle.THIN);
        style.setBorderBottom(BorderStyle.MEDIUM);
        style.setTopBorderColor(rgb(HEADER_LINE));
        style.setLeftBorderColor(rgb(HEADER_LINE));
        style.setRightBorderColor(rgb(HEADER_LINE));
        style.setBottomBorderColor(rgb(HEADER_LINE));
        XSSFFont font = wb.createFont();
        font.setFontName("微软雅黑");
        font.setFontHeightInPoints((short) 10);
        font.setBold(true);
        font.setColor(rgb(Color.WHITE));
        style.setFont(font);
        styles.put("header", style);
        return style;
    }

    private XSSFCellStyle style(String kind) {
        XSSFCellStyle cached = styles.get(kind);
        if (cached != null) {
            return cached;
        }
        XSSFCellStyle style = baseStyle();
        if ("center".equals(kind)) {
            style.setAlignment(HorizontalAlignment.CENTER);
            style.setVerticalAlignment(VerticalAlignment.CENTER);
        } else {
            style.setAlignment(HorizontalAlignment.LEFT);
            style.setVerticalAlignment(VerticalAlignment.TOP);
            style.setWrapText(true);
        }
        styles.put(kind, style);
        return style;
    }

    private XSSFCellStyle priorityStyle(String value) {
        String p = value == null ? "" : value.trim().toUpperCase();
        if (!p.matches("P[0-3]")) {
            return style("center");
        }
        String key = "pri:" + p;
        XSSFCellStyle cached = styles.get(key);
        if (cached != null) {
            return cached;
        }
        Color bg;
        Color fg;
        if ("P0".equals(p)) {
            bg = new Color(0xFE, 0xF3, 0xF2);
            fg = new Color(0xB4, 0x23, 0x18);
        } else if ("P1".equals(p)) {
            bg = new Color(0xFF, 0xFA, 0xEB);
            fg = new Color(0xB5, 0x47, 0x08);
        } else if ("P2".equals(p)) {
            bg = new Color(0xEF, 0xF4, 0xFF);
            fg = new Color(0x17, 0x5C, 0xD3);
        } else {
            bg = new Color(0xF2, 0xF4, 0xF7);
            fg = new Color(0x47, 0x54, 0x67);
        }
        XSSFCellStyle style = tintedStyle(bg, fg);
        styles.put(key, style);
        return style;
    }

    private XSSFCellStyle statusStyle(String value) {
        String key = "status:" + (value == null ? "" : value);
        XSSFCellStyle cached = styles.get(key);
        if (cached != null) {
            return cached;
        }
        String s = value == null ? "" : value.trim();
        XSSFCellStyle style;
        if ("通过".equals(s)) {
            style = tintedStyle(new Color(0xEC, 0xFD, 0xF3), new Color(0x06, 0x76, 0x47));
        } else if ("失败".equals(s)) {
            style = tintedStyle(new Color(0xFE, 0xF3, 0xF2), new Color(0xB4, 0x23, 0x18));
        } else if ("阻塞".equals(s)) {
            style = tintedStyle(new Color(0xFF, 0xFA, 0xEB), new Color(0xB5, 0x47, 0x08));
        } else if ("跳过".equals(s)) {
            style = tintedStyle(new Color(0xF2, 0xF4, 0xF7), new Color(0x47, 0x54, 0x67));
        } else {
            style = baseStyle();
            style.setAlignment(HorizontalAlignment.CENTER);
            style.setVerticalAlignment(VerticalAlignment.CENTER);
            XSSFFont font = wb.createFont();
            font.setFontName("微软雅黑");
            font.setFontHeightInPoints((short) 10);
            font.setColor(rgb(TEXT_MUTED));
            style.setFont(font);
        }
        styles.put(key, style);
        return style;
    }

    private XSSFCellStyle tintedStyle(Color bg, Color fg) {
        XSSFCellStyle style = baseStyle();
        style.setFillForegroundColor(rgb(bg));
        style.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        style.setAlignment(HorizontalAlignment.CENTER);
        style.setVerticalAlignment(VerticalAlignment.CENTER);
        XSSFFont font = wb.createFont();
        font.setFontName("微软雅黑");
        font.setFontHeightInPoints((short) 10);
        font.setBold(true);
        font.setColor(rgb(fg));
        style.setFont(font);
        return style;
    }

    private XSSFCellStyle baseStyle() {
        XSSFCellStyle style = wb.createCellStyle();
        style.setBorderTop(BorderStyle.THIN);
        style.setBorderLeft(BorderStyle.THIN);
        style.setBorderRight(BorderStyle.THIN);
        style.setBorderBottom(BorderStyle.THIN);
        style.setTopBorderColor(rgb(BORDER));
        style.setLeftBorderColor(rgb(BORDER));
        style.setRightBorderColor(rgb(BORDER));
        style.setBottomBorderColor(rgb(BORDER));
        style.setWrapText(true);
        XSSFFont font = wb.createFont();
        font.setFontName("微软雅黑");
        font.setFontHeightInPoints((short) 10);
        font.setColor(rgb(TEXT));
        style.setFont(font);
        return style;
    }

    private byte[] bytes() {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            wb.write(out);
            wb.close();
            return out.toByteArray();
        } catch (IOException ex) {
            throw new IllegalStateException("生成 Excel 失败", ex);
        }
    }

    /* ---------- 内容 ---------- */

    private static String caseNo(Integer no) {
        return no == null || no <= 0 ? "" : String.format("TC-%03d", no);
    }

    /** 步骤动作与预期各一行，行首补序号；导入时序号会被去掉，按行配对 */
    private static String stepActions(TestCaseView v) {
        StringBuilder sb = new StringBuilder();
        List<Map<String, String>> steps = parseSteps(v);
        for (int i = 0; i < steps.size(); i++) {
            if (sb.length() > 0) {
                sb.append('\n');
            }
            sb.append(i + 1).append(". ").append(oneLine(steps.get(i).get("action")));
        }
        return sb.toString();
    }

    private static String stepExpected(TestCaseView v) {
        StringBuilder sb = new StringBuilder();
        List<Map<String, String>> steps = parseSteps(v);
        for (int i = 0; i < steps.size(); i++) {
            if (sb.length() > 0) {
                sb.append('\n');
            }
            String expected = oneLine(steps.get(i).get("expected"));
            sb.append(i + 1).append(". ");
            if (!expected.isEmpty()) {
                sb.append(expected);
            }
        }
        return sb.toString();
    }

    /** 步骤里的换行会让「按行配对」错位，导出时并成一行 */
    private static String oneLine(String raw) {
        if (raw == null) {
            return "";
        }
        return raw.replaceAll("\\s*[\\r\\n]+\\s*", " ").trim();
    }

    private static List<Map<String, String>> parseSteps(TestCaseView v) {
        if (v.getSteps() != null && !v.getSteps().isEmpty()) {
            return v.getSteps();
        }
        if (v.getStepsJson() == null || v.getStepsJson().trim().isEmpty()) {
            return new ArrayList<Map<String, String>>();
        }
        try {
            return JSON.readValue(v.getStepsJson(),
                    new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, String>>>() { });
        } catch (Exception ex) {
            return new ArrayList<Map<String, String>>();
        }
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    /** 行高估算：按列宽与中英文视觉宽度折行，封顶 150pt 防止超长步骤撑满一页 */
    private static float height(List<String> values, int[] widths) {
        int lines = 1;
        for (int i = 0; i < values.size() && i < widths.length; i++) {
            String value = values.get(i);
            if (value == null || value.isEmpty()) {
                continue;
            }
            int width = Math.max(4, widths[i] - 2);
            for (String para : value.split("\r?\n", -1)) {
                int visual = 0;
                for (int c = 0; c < para.length(); c++) {
                    visual += para.charAt(c) > 0x7F ? 2 : 1;
                }
                lines += Math.max(0, (visual + width - 1) / width - 1);
            }
        }
        float h = lines * 14.5f + 6f;
        return Math.min(150f, Math.max(21f, h));
    }

    /* ---------- 读 ---------- */

    private static String text(DataFormatter fmt, FormulaEvaluator evaluator, Row row, int col) {
        org.apache.poi.ss.usermodel.Cell cell = row.getCell(col, Row.MissingCellPolicy.RETURN_BLANK_AS_NULL);
        if (cell == null) {
            return "";
        }
        try {
            String value = fmt.formatCellValue(cell, evaluator);
            return value == null ? "" : value;
        } catch (Exception ex) {
            try {
                String value = fmt.formatCellValue(cell);
                return value == null ? "" : value;
            } catch (Exception ignored) {
                return "";
            }
        }
    }

    private static boolean blank(List<String> row) {
        if (row == null) {
            return true;
        }
        for (String cell : row) {
            if (cell != null && !cell.trim().isEmpty()) {
                return false;
            }
        }
        return true;
    }

    /* ---------- 杂项 ---------- */

    private static String sheetName(String projectName) {
        String name = projectName == null ? "" : projectName.trim();
        String base = name.isEmpty() ? "测试用例" : "测试用例-" + name;
        base = base.replaceAll("[\\\\/*\\[\\]:?]", " ").trim();
        return base.length() > 31 ? base.substring(0, 31) : base;
    }

    private static XSSFColor rgb(Color color) {
        return new XSSFColor(color, null);
    }
}
