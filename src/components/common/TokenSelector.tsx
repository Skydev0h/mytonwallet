import React, {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { ApiBaseCurrency, ApiToken } from '../../api/types';
import {
  type AssetPairs,
  SettingsState,
  type UserSwapToken,
  type UserToken,
} from '../../global/types';

import { ANIMATED_STICKER_MIDDLE_SIZE_PX, TON_BLOCKCHAIN } from '../../config';
import { Big } from '../../lib/big.js/index.js';
import {
  selectAvailableUserForSwapTokens,
  selectCurrentAccountState,
  selectPopularTokens,
  selectSwapTokens,
} from '../../global/selectors';
import buildClassName from '../../util/buildClassName';
import {
  formatCurrency, getShortCurrencySymbol,
} from '../../util/formatNumber';
import { getIsAddressValid } from '../../util/getIsAddressValid';
import getBlockchainNetworkIcon from '../../util/swap/getBlockchainNetworkIcon';
import getBlockchainNetworkName from '../../util/swap/getBlockchainNetworkName';
import { ANIMATED_STICKERS_PATHS } from '../ui/helpers/animatedAssets';
import { ASSET_LOGO_PATHS } from '../ui/helpers/assetLogos';

import { useDeviceScreen } from '../../hooks/useDeviceScreen';
import useFocusAfterAnimation from '../../hooks/useFocusAfterAnimation';
import useHistoryBack from '../../hooks/useHistoryBack';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import usePrevious from '../../hooks/usePrevious';
import useScrolledState from '../../hooks/useScrolledState';
import useSyncEffect from '../../hooks/useSyncEffect';

import AnimatedIconWithPreview from '../ui/AnimatedIconWithPreview';
import ModalHeader from '../ui/ModalHeader';
import Transition from '../ui/Transition';

import styles from './TokenSelector.module.scss';

type Token = UserToken | UserSwapToken;

interface StateProps {
  token?: Token;
  userTokens?: Token[];
  popularTokens?: Token[];
  swapTokens?: UserSwapToken[];
  tokenInSlug?: string;
  pairsBySlug?: Record<string, AssetPairs>;
  balancesBySlug?: Record<string, string>;
  tokenInfoBySlug?: Record<string, ApiToken>;
  baseCurrency?: ApiBaseCurrency;
  isLoading?: boolean;
}

interface OwnProps {
  isActive?: boolean;
  shouldFilter?: boolean;
  isInsideSettings?: boolean;
  onClose: NoneToVoidFunction;
  onBack: NoneToVoidFunction;
}

enum SearchState {
  Initial,
  Search,
  Loading,
  Token,
  Empty,
}

const EMPTY_ARRAY: Token[] = [];

function TokenSelector({
  token,
  userTokens,
  swapTokens,
  popularTokens,
  shouldFilter,
  isInsideSettings,
  baseCurrency,
  tokenInSlug,
  pairsBySlug,
  balancesBySlug,
  tokenInfoBySlug,
  isActive,
  isLoading,
  onBack,
  onClose,
}: OwnProps & StateProps) {
  const {
    importToken,
    resetImportToken,
    openSettingsWithState,
    setSwapTokenIn,
    setSwapTokenOut,
    addToken,
    addSwapToken,
  } = getActions();
  const lang = useLang();

  const shortBaseSymbol = getShortCurrencySymbol(baseCurrency);

  // eslint-disable-next-line no-null/no-null
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line no-null/no-null
  const searchInputRef = useRef<HTMLInputElement>(null);

  useHistoryBack({
    isActive,
    onBack,
  });

  useFocusAfterAnimation(searchInputRef, !isActive);

  const {
    handleScroll: handleContentScroll,
  } = useScrolledState();
  const { isPortrait } = useDeviceScreen();

  const [searchValue, setSearchValue] = useState('');
  const [isResetButtonVisible, setIsResetButtonVisible] = useState(false);
  const [renderingKey, setRenderingKey] = useState(SearchState.Initial);
  const [searchTokenList, setSearchTokenList] = useState<Token[]>([]);

  const balancesBySlugPrev = usePrevious(balancesBySlug);

  // It is necessary to use useCallback instead of useLastCallback here
  const filterTokens = useCallback((tokens: Token[]) => {
    return filterAndSortTokens(tokens, tokenInSlug, pairsBySlug);
  }, [pairsBySlug, tokenInSlug]);

  const allUnimportedTonTokens = useMemo(() => {
    const balances = balancesBySlugPrev ?? balancesBySlug ?? {};
    const tokens = (swapTokens ?? EMPTY_ARRAY).filter(
      (popularToken) => {
        const isTonBlockchain = 'blockchain' in popularToken && popularToken.blockchain === TON_BLOCKCHAIN;
        const isTokenUnimported = balances[popularToken.slug] === undefined;
        return isTonBlockchain && isTokenUnimported;
      },
    );

    return tokens;
  }, [balancesBySlug, balancesBySlugPrev, swapTokens]);

  const { userTokensWithFilter, popularTokensWithFilter, swapTokensWithFilter } = useMemo(() => {
    const currentUserTokens = userTokens ?? EMPTY_ARRAY;
    const currentSwapTokens = swapTokens ?? EMPTY_ARRAY;
    const currentPopularTokens = popularTokens ?? EMPTY_ARRAY;

    if (!shouldFilter) {
      return {
        userTokensWithFilter: currentUserTokens,
        popularTokensWithFilter: currentPopularTokens,
        swapTokensWithFilter: currentSwapTokens,
      };
    }

    const filteredPopularTokens = filterTokens(currentPopularTokens);
    const filteredUserTokens = filterTokens(currentUserTokens);
    const filteredSwapTokens = filterTokens(currentSwapTokens);

    return {
      userTokensWithFilter: filteredUserTokens,
      popularTokensWithFilter: filteredPopularTokens,
      swapTokensWithFilter: filteredSwapTokens,
    };
  }, [filterTokens, popularTokens, shouldFilter, swapTokens, userTokens]);

  const filteredTokenList = useMemo(() => {
    const tokensToFilter = isInsideSettings ? allUnimportedTonTokens : swapTokensWithFilter;
    const lowerCaseSearchValue = searchValue.toLowerCase().trim();

    return tokensToFilter.filter(({
      name, symbol, keywords, isDisabled,
    }) => {
      if (isDisabled) {
        return false;
      }

      const isName = name.toLowerCase().includes(lowerCaseSearchValue);
      const isSymbol = symbol.toLowerCase().includes(lowerCaseSearchValue);
      const isKeyword = keywords?.some((key) => key.toLowerCase().includes(lowerCaseSearchValue));

      return isName || isSymbol || isKeyword;
    }).sort((a, b) => b.amount - a.amount) ?? [];
  }, [allUnimportedTonTokens, isInsideSettings, searchValue, swapTokensWithFilter]);

  const resetSearch = () => {
    setSearchValue('');
  };

  useSyncEffect(() => {
    setIsResetButtonVisible(Boolean(searchValue.length));

    const isValidAddress = getIsAddressValid(searchValue);
    let newRenderingKey = SearchState.Initial;

    if (isLoading && isValidAddress) {
      newRenderingKey = SearchState.Loading;
    } else if (token && isValidAddress) {
      newRenderingKey = SearchState.Token;
    } else if (searchValue.length && filteredTokenList.length !== 0) {
      newRenderingKey = SearchState.Search;
    } else if (filteredTokenList.length === 0) {
      newRenderingKey = SearchState.Empty;
    }

    setRenderingKey(newRenderingKey);

    if (newRenderingKey !== SearchState.Initial) {
      setSearchTokenList(filteredTokenList);
    }
  }, [searchTokenList.length, isLoading, searchValue, token, filteredTokenList]);

  useEffect(() => {
    if (getIsAddressValid(searchValue)) {
      importToken({ address: searchValue, isSwap: true });
      setRenderingKey(SearchState.Loading);
    } else {
      resetImportToken();
    }
  }, [searchValue]);

  useLayoutEffect(() => {
    if (!isActive || !scrollContainerRef.current) return;

    scrollContainerRef.current.scrollTop = 0;
  }, [isActive]);

  const handleTokenClick = useLastCallback((selectedToken: Token) => {
    if (isPortrait) {
      onBack();
    } else {
      onClose();
    }

    if (isInsideSettings) {
      addToken({ token: selectedToken as UserToken });
    } else {
      addSwapToken({ token: selectedToken as UserSwapToken });
      const setToken = shouldFilter ? setSwapTokenOut : setSwapTokenIn;
      setToken({ tokenSlug: selectedToken.slug });
    }

    resetSearch();
  });

  const handleOpenSettings = useLastCallback(() => {
    onClose();
    openSettingsWithState({ state: SettingsState.Assets });
  });

  function renderSearch() {
    return (
      <div className={styles.tokenSelectInputWrapper}>
        <i className={buildClassName(styles.tokenSelectSearchIcon, 'icon-search')} aria-hidden />
        <input
          ref={searchInputRef}
          name="token-search-modal"
          className={styles.tokenSelectInput}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder={lang('Name or Address...')}
          value={searchValue}
        />
        <Transition
          name="fade"
          activeKey={isResetButtonVisible ? 0 : 1}
          className={styles.tokenSelectSearchResetWrapper}
        >
          {isResetButtonVisible && (
            <i
              className={buildClassName(
                styles.tokenSelectSearchReset,
                'icon-close',
              )}
              aria-hidden
              onClick={resetSearch}
            />
          )}
        </Transition>
      </div>
    );
  }

  function renderToken(currentToken: Token) {
    const image = ASSET_LOGO_PATHS[
      currentToken?.symbol.toLowerCase() as keyof typeof ASSET_LOGO_PATHS
    ] ?? currentToken?.image;
    const blockchain = 'blockchain' in currentToken ? currentToken.blockchain : TON_BLOCKCHAIN;
    const price = 'price' in currentToken
      ? currentToken.price
      : tokenInfoBySlug?.[currentToken.slug]
        ? tokenInfoBySlug?.[currentToken.slug].quote.price
        : 0;

    const isAvailable = !shouldFilter || currentToken.canSwap;
    const descriptionText = isAvailable
      ? getBlockchainNetworkName(blockchain)
      : lang('Unavailable');
    const currencyHoldings = Big(price).mul(currentToken.amount);
    const handleClick = isAvailable ? () => handleTokenClick(currentToken) : undefined;

    return (
      <div
        key={currentToken.slug}
        className={buildClassName(
          styles.tokenContainer,
          !isAvailable && styles.tokenContainerDisabled,
        )}
        onClick={handleClick}
      >
        <div className={styles.tokenLogoContainer}>
          <div className={styles.logoContainer}>
            <img
              src={image}
              alt={currentToken.symbol}
              className={buildClassName(
                styles.tokenLogo,
                !isAvailable && styles.tokenLogoDisabled,
              )}
            />
            <img
              className={styles.tokenNetworkLogo}
              alt={blockchain}
              src={getBlockchainNetworkIcon(blockchain)}
            />
            {!isAvailable && <span className={styles.tokenNetworkLogoDisabled} />}
          </div>
          <div className={styles.nameContainer}>
            <span className={buildClassName(styles.tokenName, !isAvailable && styles.tokenTextDisabled)}>
              {currentToken.name}
            </span>
            <span
              className={buildClassName(
                styles.tokenNetwork,
                !isAvailable && styles.tokenTextDisabled,
              )}
            >
              {descriptionText}
            </span>
          </div>
        </div>
        <div className={styles.tokenPriceContainer}>
          <span className={buildClassName(
            styles.tokenAmount,
            !isAvailable && styles.tokenTextDisabled,
          )}
          >
            {formatCurrency(currentToken.amount, currentToken.symbol)}
          </span>
          <span className={buildClassName(
            styles.tokenValue,
            !isAvailable && styles.tokenTextDisabled,
          )}
          >
            {formatCurrency(currencyHoldings.toNumber(), shortBaseSymbol)}
          </span>
        </div>
      </div>
    );
  }

  function renderTokenGroup(tokens: Token[], title: string, shouldShowSettings?: boolean) {
    return (
      <div className={styles.tokenGroupContainer}>
        <div className={styles.tokenGroupHeader}>
          <span className={styles.tokenGroupTitle}>{title}</span>
          {shouldShowSettings && (
            <span
              className={styles.tokenGroupAdditionalTitle}
              onClick={handleOpenSettings}
            >
              {lang('Settings')}
            </span>
          )}
        </div>
        {tokens.map(renderToken)}
      </div>
    );
  }

  function renderAllTokens(tokens: Token[]) {
    return (
      <div className={styles.tokenGroupContainer}>
        {tokens.map(renderToken)}
      </div>
    );
  }

  function renderTokenSkeleton() {
    return (
      <div className={buildClassName(styles.tokenContainer, styles.tokenContainerDisabled)}>
        <div className={styles.tokenLogoContainer}>
          <div className={styles.logoContainer}>
            <div className={styles.tokenLogoSkeleton} />
            <div className={styles.tokenNetworkLogoSkeleton} />
          </div>
          <div className={styles.nameContainer}>
            <span className={styles.tokenNameSkeleton} />
            <span className={styles.tokenValueSkeleton} />
          </div>
        </div>
        <div className={styles.tokenPriceContainer}>
          <span className={buildClassName(styles.tokenNameSkeleton, styles.rotateSkeleton)} />
          <span className={styles.tokenValueSkeleton} />
        </div>
      </div>
    );
  }

  function renderNotFound(shouldPlay: boolean) {
    return (
      <div className={styles.tokenNotFound}>
        <AnimatedIconWithPreview
          play={shouldPlay}
          tgsUrl={ANIMATED_STICKERS_PATHS.noData}
          previewUrl={ANIMATED_STICKERS_PATHS.noDataPreview}
          size={ANIMATED_STICKER_MIDDLE_SIZE_PX}
          noLoop={false}
          nonInteractive
        />
        <span className={styles.tokenNotFoundTitle}>{lang('Not Found')}</span>
        <span className={styles.tokenNotFoundDesc}>{lang('Try another keyword or address.')}</span>
      </div>
    );
  }

  function renderSearchResults(tokenToImport?: Token) {
    if (tokenToImport) {
      return (
        <div className={styles.tokenGroupContainer}>
          {renderToken(tokenToImport)}
        </div>
      );
    }

    return (
      <>
        {renderTokenSkeleton()}
        {renderTokenSkeleton()}
        {renderTokenSkeleton()}
        {renderTokenSkeleton()}
        {renderTokenSkeleton()}
      </>
    );
  }

  function renderTokenGroups() {
    if (isInsideSettings) {
      return renderTokenGroup(allUnimportedTonTokens, lang('A-Z'));
    }

    return (
      <>
        {renderTokenGroup(userTokensWithFilter, lang('MY'), true)}
        {renderTokenGroup(popularTokensWithFilter, lang('POPULAR'))}
        {renderTokenGroup(swapTokensWithFilter, lang('A-Z'))}
      </>
    );
  }

  // eslint-disable-next-line consistent-return
  function renderContent(isContentActive: boolean, isFrom: boolean, currentKey: number) {
    switch (currentKey) {
      case SearchState.Initial:
        return renderTokenGroups();
      case SearchState.Loading:
        return renderSearchResults();
      case SearchState.Search:
        return renderAllTokens(searchTokenList);
      case SearchState.Token:
        return renderSearchResults(token);
      case SearchState.Empty:
        return renderNotFound(isContentActive);
    }
  }

  return (
    <>
      <ModalHeader title={lang('Select Token')} onBackButtonClick={onBack} onClose={onClose} />
      {renderSearch()}

      <div
        className={buildClassName(
          styles.tokenSelectContent,
          'custom-scroll',
        )}
        onScroll={handleContentScroll}
        ref={scrollContainerRef}
      >
        <Transition
          name="fade"
          activeKey={renderingKey}
        >
          {renderContent}
        </Transition>
      </div>
    </>
  );
}

export default memo(withGlobal<OwnProps>((global): StateProps => {
  const balances = selectCurrentAccountState(global)?.balances;
  const { isLoading, token } = global.settings.importToken ?? {};
  const { pairs, tokenInSlug } = global.currentSwap ?? {};

  const userTokens = selectAvailableUserForSwapTokens(global);
  const popularTokens = selectPopularTokens(global);
  const swapTokens = selectSwapTokens(global);
  const { baseCurrency } = global.settings;

  return {
    isLoading,
    token,
    userTokens,
    popularTokens,
    swapTokens,
    tokenInSlug,
    baseCurrency,
    pairsBySlug: pairs?.bySlug,
    balancesBySlug: balances?.bySlug,
    tokenInfoBySlug: global.tokenInfo.bySlug,
  };
})(TokenSelector));

function filterAndSortTokens(tokens: Token[], tokenInSlug?: string, pairsBySlug?: Record<string, AssetPairs>) {
  if (!tokens.length || !tokenInSlug) return [];

  return tokens.map((token) => {
    const canSwap = Boolean(pairsBySlug?.[tokenInSlug]?.[token.slug]);
    return { ...token, canSwap };
  }).sort((a, b) => Number(b.canSwap) - Number(a.canSwap));
}
