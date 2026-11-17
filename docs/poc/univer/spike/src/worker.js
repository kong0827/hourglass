import { Univer, LocaleType } from "@univerjs/core";
import { UniverDocsWorkerPlugin } from "@univerjs/docs/worker";

const univer = new Univer({ locale: LocaleType.EN_US });
univer.registerPlugin(UniverDocsWorkerPlugin);

self.__spikeWorker = univer;
