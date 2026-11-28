package com.hourglass.controller;

import com.hourglass.common.ApiResult;
import com.hourglass.common.CurrentUser;
import com.hourglass.entity.WeComCorp;
import com.hourglass.entity.WeComMsgLog;
import com.hourglass.entity.Workspace;
import com.hourglass.mapper.WeComMsgLogMapper;
import com.hourglass.service.AuditService;
import com.hourglass.service.WorkspaceService;
import com.hourglass.wecom.WeComCorpService;
import com.hourglass.wecom.WeComGroupRobotRequest;
import com.hourglass.wecom.WeComGroupRobotService;
import com.hourglass.wecom.WeComNotifyService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 空间设置 → 企业微信：空间主选择本空间启用哪些企业，查看按企业分组的发送记录。
 * 一家企业可被多个空间启用；停用只影响本空间，不动其它空间。
 */
@RestController
public class WeComWorkspaceController {

    private final WorkspaceService workspaceService;
    private final WeComCorpService corpService;
    private final WeComNotifyService notifyService;
    private final WeComGroupRobotService groupRobotService;
    private final WeComMsgLogMapper msgMapper;
    private final AuditService audit;

    public WeComWorkspaceController(WorkspaceService workspaceService, WeComCorpService corpService,
                                    WeComNotifyService notifyService, WeComGroupRobotService groupRobotService,
                                    WeComMsgLogMapper msgMapper, AuditService audit) {
        this.workspaceService = workspaceService;
        this.corpService = corpService;
        this.notifyService = notifyService;
        this.groupRobotService = groupRobotService;
        this.msgMapper = msgMapper;
        this.audit = audit;
    }

    @GetMapping("/api/wecom/workspace")
    public ApiResult<Map<String, Object>> view(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireMember(userId, ws.getId());
        boolean canManage = "owner".equals(ws.getMyRole()) || "admin".equals(ws.getMyRole());

        List<Map<String, Object>> enabled = new ArrayList<Map<String, Object>>();
        for (WeComCorp corp : corpService.listForWorkspace(ws.getId())) {
            Map<String, Object> item = new LinkedHashMap<String, Object>();
            item.put("id", corp.getId());
            item.put("corpName", corp.getCorpName());
            item.put("corpId", corp.getCorpId());
            item.put("status", corp.getStatus());
            enabled.add(item);
        }
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("canManage", Boolean.valueOf(canManage));
        data.put("enabledCorps", enabled);
        if (canManage) {
            List<Map<String, Object>> all = new ArrayList<Map<String, Object>>();
            for (WeComCorp corp : corpService.listAll()) {
                Map<String, Object> item = new LinkedHashMap<String, Object>();
                item.put("id", corp.getId());
                item.put("corpName", corp.getCorpName());
                item.put("corpId", corp.getCorpId());
                item.put("status", corp.getStatus());
                all.add(item);
            }
            data.put("allCorps", all);
            data.put("messages", msgMapper.selectRecent(ws.getId(), null, 50));
            data.put("groupRobots", groupRobotService.list(ws.getId()));
        }
        return ApiResult.ok(data);
    }

    /** 全量设置本空间启用的企业（按配置 ID 提交；落库为真实 CorpID） */
    @PutMapping("/api/wecom/workspace/corps")
    public ApiResult<Map<String, Object>> setCorps(@RequestParam(required = false) String workspace,
                                                   @RequestBody Map<String, Object> body,
                                                   HttpServletRequest request) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireManager(userId, ws.getId());
        List<String> ids = new ArrayList<String>();
        Object raw = body.get("corpIds");
        if (raw instanceof List) {
            for (Object item : (List<?>) raw) {
                ids.add(String.valueOf(item));
            }
        }
        corpService.setWorkspaceCorps(ws.getId(), userId, ids);
        audit.recordCurrent(ws.getId(), "wecom.space.corps", "workspace", ws.getId(), ws.getName(),
                true, "启用企业微信企业数=" + ids.size(), request);
        return view(workspace);
    }

    @PostMapping("/api/wecom/workspace/messages/{id}/retry")
    public ApiResult<Map<String, Object>> retry(@PathVariable String id,
                                                @RequestParam(required = false) String workspace,
                                                HttpServletRequest request) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireManager(userId, ws.getId());
        WeComMsgLog row = msgMapper.selectById(id);
        if (row == null || !ws.getId().equals(row.getWorkspaceId())) {
            throw com.hourglass.common.AppException.notFound("消息记录不存在");
        }
        notifyService.retry(id);
        audit.recordCurrent(ws.getId(), "wecom.msg.retry", "wecom_msg", id, row.getTitle(),
                true, "手工重发企微消息", request);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("retried", Boolean.TRUE);
        return ApiResult.ok(data);
    }

    /** 兼容前端一次性拿到「本空间启用了哪些企业 ID」，用于勾选态回显 */
    @GetMapping("/api/wecom/workspace/corps")
    public ApiResult<Map<String, Object>> corps(@RequestParam(required = false) String workspace) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireMember(userId, ws.getId());
        Set<String> ids = new HashSet<String>();
        for (WeComCorp corp : corpService.listForWorkspace(ws.getId())) {
            ids.add(corp.getId());
        }
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("corpIds", new ArrayList<String>(ids));
        return ApiResult.ok(data);
    }

    /** 空间主/管理员：按企业添加群机器人；Webhook 只接受企微官方地址，密文保存。 */
    @PostMapping("/api/wecom/workspace/group-robots")
    public ApiResult<Map<String, Object>> createGroupRobot(@RequestParam(required = false) String workspace,
                                                           @RequestBody WeComGroupRobotRequest body,
                                                           HttpServletRequest request) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireManager(userId, ws.getId());
        Map<String, Object> item = groupRobotService.create(ws.getId(), userId, body);
        audit.recordCurrent(ws.getId(), "wecom.group_robot.create", "wecom_group_robot",
                String.valueOf(item.get("id")), String.valueOf(item.get("name")),
                true, "新增企业微信群机器人（" + item.get("corpId") + "）", request);
        return ApiResult.ok(item);
    }

    @PutMapping("/api/wecom/workspace/group-robots/{id}")
    public ApiResult<Map<String, Object>> updateGroupRobot(@PathVariable String id,
                                                           @RequestParam(required = false) String workspace,
                                                           @RequestBody WeComGroupRobotRequest body,
                                                           HttpServletRequest request) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireManager(userId, ws.getId());
        Map<String, Object> item = groupRobotService.update(ws.getId(), id, body);
        audit.recordCurrent(ws.getId(), "wecom.group_robot.update", "wecom_group_robot", id,
                String.valueOf(item.get("name")), true, "修改企业微信群机器人", request);
        return ApiResult.ok(item);
    }

    @PostMapping("/api/wecom/workspace/group-robots/{id}/status")
    public ApiResult<Map<String, Object>> setGroupRobotStatus(@PathVariable String id,
                                                              @RequestParam(required = false) String workspace,
                                                              @RequestBody Map<String, Object> body,
                                                              HttpServletRequest request) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireManager(userId, ws.getId());
        String status = body.get("status") == null ? "" : String.valueOf(body.get("status"));
        groupRobotService.setStatus(ws.getId(), id, status);
        audit.recordCurrent(ws.getId(), "wecom.group_robot.status", "wecom_group_robot", id,
                null, true, "企业微信群机器人状态=" + status, request);
        Map<String, Object> data = new LinkedHashMap<String, Object>();
        data.put("status", status);
        return ApiResult.ok(data);
    }

    @PostMapping("/api/wecom/workspace/group-robots/{id}/test")
    public ApiResult<Map<String, Object>> testGroupRobot(@PathVariable String id,
                                                         @RequestParam(required = false) String workspace,
                                                         HttpServletRequest request) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireManager(userId, ws.getId());
        Map<String, Object> result = groupRobotService.test(ws.getId(), id);
        boolean sent = Boolean.TRUE.equals(result.get("sent"));
        audit.recordCurrent(ws.getId(), "wecom.group_robot.test", "wecom_group_robot", id,
                null, sent, "企业微信群机器人测试：" + result.get("message"), request);
        return ApiResult.ok(result);
    }

    @DeleteMapping("/api/wecom/workspace/group-robots/{id}")
    public ApiResult<Void> deleteGroupRobot(@PathVariable String id,
                                            @RequestParam(required = false) String workspace,
                                            HttpServletRequest request) {
        String userId = CurrentUser.id();
        Workspace ws = workspaceService.resolve(userId, workspace);
        workspaceService.requireManager(userId, ws.getId());
        groupRobotService.delete(ws.getId(), id);
        audit.recordCurrent(ws.getId(), "wecom.group_robot.delete", "wecom_group_robot", id,
                null, true, "删除企业微信群机器人", request);
        return ApiResult.ok();
    }
}