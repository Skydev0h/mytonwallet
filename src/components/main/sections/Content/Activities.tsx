import type { RefObject } from 'react';
import React, {
  memo, useEffect, useLayoutEffect, useMemo, useRef,
} from '../../../../lib/teact/teact';
import { setExtraStyles } from '../../../../lib/teact/teact-dom';
import { getActions, withGlobal } from '../../../../global';

import type { ApiActivity, ApiSwapAsset, ApiToken } from '../../../../api/types';
import { ContentTab } from '../../../../global/types';

import {
  ANIMATED_STICKER_BIG_SIZE_PX, MIN_ASSETS_TAB_VIEW, TON_TOKEN_SLUG,
} from '../../../../config';
import { getIsSwapId, getIsTinyTransaction, getIsTxIdLocal } from '../../../../global/helpers';
import {
  selectCurrentAccountState, selectCurrentAccountTokens, selectEnabledTokensCountMemoized, selectIsNewWallet,
} from '../../../../global/selectors';
import buildClassName from '../../../../util/buildClassName';
import { compareActivities } from '../../../../util/compareActivities';
import { formatHumanDay, getDayStartAt } from '../../../../util/dateFormat';
import { findLast, unique } from '../../../../util/iteratees';
import { ANIMATED_STICKERS_PATHS } from '../../../ui/helpers/animatedAssets';

import { useDeviceScreen } from '../../../../hooks/useDeviceScreen';
import useInfiniteScroll from '../../../../hooks/useInfiniteScroll';
import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';
import useThrottledCallback from '../../../../hooks/useThrottledCallback';

import AnimatedIconWithPreview from '../../../ui/AnimatedIconWithPreview';
import InfiniteScroll from '../../../ui/InfiniteScroll';
import Loading from '../../../ui/Loading';
import NewWalletGreeting from './NewWalletGreeting';
import Swap from './Swap';
import Transaction from './Transaction';

import styles from './Activities.module.scss';

interface OwnProps {
  isActive?: boolean;
  mobileRef?: RefObject<HTMLDivElement>;
}

type StateProps = {
  currentAccountId: string;
  slug?: string;
  isNewWallet: boolean;
  areTinyTransfersHidden?: boolean;
  byId?: Record<string, ApiActivity>;
  idsBySlug?: Record<string, string[]>;
  tokensBySlug?: Record<string, ApiToken>;
  swapTokensBySlug?: Record<string, ApiSwapAsset>;
  currentActivityId?: string;
  apyValue: number;
  savedAddresses?: Record<string, string>;
  isMainHistoryEndReached?: boolean;
  isHistoryEndReachedBySlug?: Record<string, boolean>;
};

interface ActivityOffsetInfo {
  offset: number;
  offsetNext: number;
  dateCount: number;
  commentCount: number;
  date: number;
}

const FURTHER_SLICE = 30;
const THROTTLE_TIME = 1000;

const DATE_HEADER_HEIGHT = 40;
const TRANSACTION_COMMENT_HEIGHT = 35;
const TRANSACTION_HEIGHT = 64;

const TIME_BETWEEN_SWAP_AND_TX = 3600000; // 1 hour

function Activities({
  isActive,
  mobileRef,
  currentAccountId,
  isNewWallet,
  slug,
  idsBySlug,
  byId,
  tokensBySlug,
  swapTokensBySlug,
  areTinyTransfersHidden,
  currentActivityId,
  apyValue,
  savedAddresses,
  isMainHistoryEndReached,
  isHistoryEndReachedBySlug,
}: OwnProps & StateProps) {
  const {
    fetchTokenTransactions, fetchAllTransactions, showActivityInfo,
  } = getActions();

  const lang = useLang();
  const { isLandscape } = useDeviceScreen();

  // eslint-disable-next-line no-null/no-null
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line no-null/no-null
  const portraitContainerRef = useRef<HTMLDivElement>(null);

  const ids = useMemo(() => {
    let idList: string[] | undefined;

    const bySlug = idsBySlug ?? {};

    if (byId) {
      if (slug) {
        idList = bySlug[slug] ?? [];
        const lastTokenTxId = findLast(idList, (id) => !getIsTxIdLocal(id) && !getIsSwapId(id));

        if (lastTokenTxId) {
          const lastTokenTxTimestamp = byId[lastTokenTxId].timestamp - TIME_BETWEEN_SWAP_AND_TX;
          idList = idList.filter((txId) => byId[txId].timestamp >= lastTokenTxTimestamp);
        }
      } else {
        const lastTonTxId = findLast(bySlug[TON_TOKEN_SLUG] ?? [], (id) => !getIsTxIdLocal(id) && !getIsSwapId(id));
        idList = unique(Object.values(bySlug).flat());
        if (lastTonTxId) {
          idList = idList.filter((txId) => byId[txId].timestamp >= byId[lastTonTxId].timestamp);
        }

        idList.sort((a, b) => compareActivities(byId[a], byId[b]));
      }
    }
    if (!idList) {
      return undefined;
    }

    return idList;
  }, [byId, slug, idsBySlug]);

  const activityList = useMemo(() => {
    if (!ids) {
      return undefined;
    }

    const allActivities = ids
      .map((id) => byId?.[id])
      .filter((activity) => {
        if (activity?.shouldHide) {
          return false;
        }
        if (activity?.kind === 'swap') {
          return Boolean(!slug || activity.from === slug || activity.to === slug);
        } else {
          return Boolean(
            activity?.slug
            && (!slug || activity.slug === slug)
            && (!areTinyTransfersHidden || !getIsTinyTransaction(activity, tokensBySlug![activity.slug])),
          );
        }
      }) as ApiActivity[];

    if (!allActivities.length) {
      return [];
    }

    return allActivities;
  }, [areTinyTransfersHidden, byId, ids, slug, tokensBySlug]);

  const { activityIds, activitiesById } = useMemo(() => {
    const activityIdList: string[] = [];
    const activityMap: Record<string, ApiActivity> = {};

    activityList?.forEach((activity) => {
      activityIdList.push(activity.id);
      activityMap[activity.id] = activity;
    });

    return { activityIds: activityIdList, activitiesById: activityMap };
  }, [activityList]);

  const isHistoryEndReached = useMemo(() => {
    if (slug) {
      return !!isHistoryEndReachedBySlug?.[slug];
    }

    return !!isMainHistoryEndReached;
  }, [isHistoryEndReachedBySlug, isMainHistoryEndReached, slug]);

  const loadMore = useLastCallback(() => {
    if (slug) {
      fetchTokenTransactions({ slug, limit: FURTHER_SLICE * 2, shouldLoadWithBudget: true });
    } else {
      fetchAllTransactions({ limit: FURTHER_SLICE * 2, shouldLoadWithBudget: true });
    }
  });

  const throttledLoadMore = useThrottledCallback(loadMore, [loadMore], THROTTLE_TIME, true);

  const [viewportIds, getMore, resetScroll] = useInfiniteScroll(
    throttledLoadMore, activityIds, undefined, FURTHER_SLICE, slug, isActive,
  );

  const isActivitiesEmpty = !activityList || !activityList.length;

  const activityOffsetInfoById = useMemo(() => {
    const offsetMap: Record<string, ActivityOffsetInfo> = {};

    let dateCount = 0;
    let commentCount = 0;
    let lastActivityDayStart = 0;

    activityIds.forEach((id, index) => {
      const activity = activitiesById[id];
      if (!activity) return;

      offsetMap[id] = {
        offset: 0,
        offsetNext: 0,
        dateCount: 0,
        commentCount: 0,
        date: lastActivityDayStart,
      };

      const offsetTop = calculateOffset(index, dateCount, commentCount);
      const activityDayStart = getDayStartAt(activity.timestamp);
      const isNewDay = lastActivityDayStart !== activityDayStart;
      if (isNewDay) {
        lastActivityDayStart = activityDayStart;
        dateCount += 1;
      }

      if (activity.kind === 'transaction' && !activity.type && (activity.comment || activity.encryptedComment)) {
        commentCount += 1;
      }

      offsetMap[id] = {
        ...offsetMap[id],
        offset: offsetTop,
        offsetNext: calculateOffset(index + 1, dateCount, commentCount),
        dateCount,
        commentCount,
      };
    });

    return offsetMap;
  }, [activitiesById, activityIds]);

  const currentContainerHeight = useMemo(
    () => {
      const lastViewportId = viewportIds![viewportIds!.length - 1];
      const activityInfo = activityOffsetInfoById[lastViewportId];

      if (!activityInfo) return 0;

      return activityInfo.offsetNext;
    },
    [activityOffsetInfoById, viewportIds],
  );

  useEffect(() => {
    if (!isHistoryEndReached && ids && isActivitiesEmpty) {
      throttledLoadMore();
    }
  }, [ids, isActivitiesEmpty, isHistoryEndReached, throttledLoadMore]);

  useEffect(() => {
    if (!isActive && !isLandscape) {
      resetScroll?.();
    }
  }, [isActive, isLandscape, resetScroll]);

  useLayoutEffect(() => {
    if (isLandscape && containerRef.current) {
      setExtraStyles(containerRef.current, { height: '' });
      return;
    }

    if (!containerRef.current || !mobileRef?.current) return;

    portraitContainerRef.current = mobileRef.current?.closest<HTMLDivElement>('.app-slide-content');

    setExtraStyles(containerRef.current, { height: `${currentContainerHeight}px` });
  }, [isLandscape, currentContainerHeight, mobileRef]);

  const handleActivityClick = useLastCallback((id: string) => {
    showActivityInfo({ id });
  });

  if (!currentAccountId) {
    return undefined;
  }

  function renderActivity(activity: ApiActivity, isLast: boolean, isActivityActive: boolean) {
    const isSwap = activity.kind === 'swap';

    if (isSwap) {
      return (
        <Swap
          key={activity.id}
          activity={activity}
          tokensBySlug={swapTokensBySlug}
          isLast={isLast}
          isActive={isActivityActive}
          onClick={handleActivityClick}
        />
      );
    } else {
      return (
        <Transaction
          key={activity.id}
          transaction={activity}
          tokensBySlug={tokensBySlug}
          isActive={isActivityActive}
          apyValue={apyValue}
          isLast={isLast}
          savedAddresses={savedAddresses}
          onClick={handleActivityClick}
        />
      );
    }
  }

  function renderHistory() {
    return viewportIds!.map((id, index) => {
      const activityInfo = activityOffsetInfoById[id];

      const nextActivityId = viewportIds![index + 1];
      const activity = activitiesById[id];
      const nextActivity = activitiesById[nextActivityId];
      if (!activity) return undefined;

      const activityDayStart = getDayStartAt(activity.timestamp);
      const isNewDay = activityInfo.date !== activityDayStart;

      const nextActivityDayStart = nextActivity ? getDayStartAt(nextActivity.timestamp) : 0;
      const isLast = !nextActivityId || activityInfo.date !== nextActivityDayStart;

      const isActivityActive = activity.id === currentActivityId;

      return (
        <div
          key={id}
          style={`top: ${activityInfo.offset}px`}
          className={buildClassName('ListItem', styles.listItem)}
        >
          {isNewDay && <div className={styles.date}>{formatHumanDay(lang, activityDayStart)}</div>}
          {renderActivity(activity, isLast, isActivityActive)}
        </div>
      );
    });
  }

  if (isNewWallet && isActivitiesEmpty) {
    return (
      <div className={buildClassName(isLandscape && styles.greeting)}>
        <NewWalletGreeting isActive={isActive} mode={isLandscape ? 'emptyList' : 'panel'} />
      </div>
    );
  }

  if (isHistoryEndReached && isActivitiesEmpty) {
    return (
      <div className={styles.emptyList}>
        <AnimatedIconWithPreview
          play={isActive}
          tgsUrl={ANIMATED_STICKERS_PATHS.noData}
          previewUrl={ANIMATED_STICKERS_PATHS.noDataPreview}
          size={ANIMATED_STICKER_BIG_SIZE_PX}
          className={styles.sticker}
          noLoop={false}
          nonInteractive
        />
        <p className={styles.emptyListTitle}>{lang('No Activity')}</p>
      </div>
    );
  }

  if (!ids || isActivitiesEmpty) {
    return (
      <div className={buildClassName(styles.emptyList, styles.emptyListLoading)}>
        <Loading />
      </div>
    );
  }

  return (
    <InfiniteScroll
      className={buildClassName('custom-scroll', styles.listGroup)}
      ref={containerRef}
      scrollRef={isLandscape ? undefined : portraitContainerRef}
      items={viewportIds}
      preloadBackwards={FURTHER_SLICE}
      withAbsolutePositioning
      maxHeight={currentContainerHeight}
      onLoadMore={getMore}
    >
      {renderHistory()}
    </InfiniteScroll>
  );
}

export default memo(
  withGlobal<OwnProps>(
    (global): StateProps => {
      const accountState = selectCurrentAccountState(global);
      const isNewWallet = selectIsNewWallet(global);
      const slug = accountState?.currentTokenSlug;
      const {
        idsBySlug, byId, isMainHistoryEndReached, isHistoryEndReachedBySlug,
      } = accountState?.activities ?? {};
      return {
        currentAccountId: global.currentAccountId!,
        slug,
        byId,
        isNewWallet,
        idsBySlug,
        tokensBySlug: global.tokenInfo?.bySlug,
        swapTokensBySlug: global.swapTokenInfo?.bySlug,
        areTinyTransfersHidden: global.settings.areTinyTransfersHidden,
        apyValue: accountState?.staking?.apy || 0,
        savedAddresses: accountState?.savedAddresses,
        isMainHistoryEndReached,
        isHistoryEndReachedBySlug,
        currentActivityId: accountState?.currentActivityId,
      };
    },
    (global, _, stickToFirst) => {
      const tokens = selectCurrentAccountTokens(global);
      const accountState = selectCurrentAccountState(global);
      const tokensCount = selectEnabledTokensCountMemoized(tokens);
      const shouldShowSeparateAssetsPanel = tokensCount > 0 && tokensCount < MIN_ASSETS_TAB_VIEW;

      return stickToFirst((
        accountState?.activeContentTab === ContentTab.Activity
        || (accountState?.activeContentTab === ContentTab.Assets && shouldShowSeparateAssetsPanel)
      ) && global.currentAccountId);
    },
  )(Activities),
);

function calculateOffset(index: number, dateCount: number, commentCount: number) {
  const commentOffset = commentCount * TRANSACTION_COMMENT_HEIGHT;
  const dateOffset = dateCount * DATE_HEADER_HEIGHT;
  return index * TRANSACTION_HEIGHT + dateOffset + commentOffset;
}
