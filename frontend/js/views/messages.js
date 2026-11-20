/* views/messages · 消息中心完整页
   与右上角通知面板共用同一份结构与点击处理，避免两处口径漂移 */
import { $ } from "../core/dom.js";
import { enterMessagesView as enterCenter, handleNoticeClick } from "../core/notifications.js";

function enterMessages(){
  enterCenter();
}
var body = $("messagesBody");
if(body && !body.__wired){
  body.__wired = true;
  body.addEventListener("click", handleNoticeClick);
}
/* 页头的「通知偏好 / 全部标为已读」与正文是同一份动作；手机页头折叠时只留正文那一份 */
var acts = $("pageActions");
if(acts && !acts.__msgWired){
  acts.__msgWired = true;
  acts.addEventListener("click", function(e){
    if(document.body.dataset.view !== "messages") return;
    handleNoticeClick(e);
  });
}
export { enterMessages as enterMessagesView };
