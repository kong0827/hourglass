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
export { enterMessages as enterMessagesView };
